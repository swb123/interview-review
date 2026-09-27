import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { loadBank } from "../src/data/questions.js";
import { judge } from "../src/judge/judge.js";
import { percentile, writeTrace } from "../src/observability/trace.js";

/**
 * 判分评测：跑标注好的 golden set，输出与标注的一致率、分数区间命中率、
 * 重复判分稳定性、结构化输出通道分布、延迟与 token 成本。
 *
 * 用法：
 *   npm run eval                          # 全量，每条 1 次
 *   npm run eval -- --repeat 3            # 每条 3 次（测稳定性）
 *   npm run eval -- --tag injection       # 只跑某个标签
 *   npm run eval -- --limit 5 --concurrency 2
 *
 * 结果写入 eval/results/<时间戳>.json 与 eval/results/latest.md。
 */

interface GoldenCase {
  id: string;
  questionId: string;
  tags: string[];
  answer: string;
  label: { verdict: "clear" | "unclear"; score: [number, number] };
}

interface Run {
  via: "tool" | "text" | "fallback";
  verdict?: "clear" | "unclear";
  score?: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  iterations: number;
  error?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = join(__dirname, "..", "eval");

function parseArgs(argv: string[]) {
  const out = { repeat: 1, concurrency: 4, tag: undefined as string | undefined, limit: undefined as number | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repeat") out.repeat = Math.max(1, Number(argv[++i]));
    else if (a === "--concurrency") out.concurrency = Math.max(1, Number(argv[++i]));
    else if (a === "--tag") out.tag = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const pct = (n: number, d: number) => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const golden = JSON.parse(readFileSync(join(EVAL_DIR, "golden.json"), "utf8")) as { cases: GoldenCase[] };
  let cases = golden.cases;
  if (args.tag) cases = cases.filter((c) => c.tags.includes(args.tag!));
  if (args.limit) cases = cases.slice(0, args.limit);
  if (!config.authToken) {
    console.error("未配置 ANTHROPIC_AUTH_TOKEN，无法运行评测");
    process.exit(1);
  }

  const bank = loadBank();
  const jobs = cases.flatMap((c) => Array.from({ length: args.repeat }, () => c));
  console.log(`模型 ${config.model} · ${cases.length} 条用例 × ${args.repeat} 次 = ${jobs.length} 次判分 · 并发 ${args.concurrency}\n`);

  let done = 0;
  const runs = await pool(jobs, args.concurrency, async (c): Promise<[string, Run]> => {
    const t0 = Date.now();
    let run: Run;
    try {
      const r = await judge({ bank }, { questionId: c.questionId, userAnswer: c.answer });
      writeTrace({ mode: "eval", questionId: c.questionId, via: r.via }, r.stats);
      run = {
        via: r.via,
        verdict: r.via === "fallback" ? undefined : r.judgement.verdict,
        score: r.via === "fallback" ? undefined : r.judgement.score,
        ms: Date.now() - t0,
        inputTokens: r.stats?.totalInputTokens ?? 0,
        outputTokens: r.stats?.totalOutputTokens ?? 0,
        iterations: r.stats?.iterations ?? 0,
      };
    } catch (err) {
      run = { via: "fallback", ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, iterations: 0, error: (err as Error).message };
    }
    done++;
    const mark = run.verdict === undefined ? "✗" : run.verdict === c.label.verdict ? "✓" : "✗";
    console.log(`[${done}/${jobs.length}] ${mark} ${c.id.padEnd(18)} ${run.via.padEnd(8)} ${run.verdict ?? "-"} ${run.score ?? "-"}  (${(run.ms / 1000).toFixed(1)}s)${run.error ? "  " + run.error : ""}`);
    return [c.id, run];
  });

  // ---- 聚合 ----
  const byCase = new Map<string, Run[]>();
  for (const [id, r] of runs) byCase.set(id, [...(byCase.get(id) ?? []), r]);

  const all = runs.map(([, r]) => r);
  const judged = all.filter((r) => r.verdict !== undefined);
  const caseOf = (id: string) => cases.find((c) => c.id === id)!;

  let agree = 0;
  let inRange = 0;
  let tp = 0, fp = 0, fn = 0, tn = 0; // 以 clear 为正类
  const absErr: number[] = [];
  for (const [id, r] of runs) {
    if (r.verdict === undefined || r.score === undefined) continue;
    const c = caseOf(id);
    if (r.verdict === c.label.verdict) agree++;
    const [lo, hi] = c.label.score;
    if (r.score >= lo && r.score <= hi) inRange++;
    absErr.push(r.score < lo ? lo - r.score : r.score > hi ? r.score - hi : 0);
    if (r.verdict === "clear" && c.label.verdict === "clear") tp++;
    else if (r.verdict === "clear") fp++;
    else if (c.label.verdict === "clear") fn++;
    else tn++;
  }

  const stability = [...byCase.entries()]
    .filter(([, rs]) => rs.length > 1)
    .map(([id, rs]) => {
      const scores = rs.map((r) => r.score).filter((s): s is number => s !== undefined);
      const verdicts = new Set(rs.map((r) => r.verdict).filter(Boolean));
      return { id, std: std(scores), flip: verdicts.size > 1 };
    });

  const tags = [...new Set(cases.flatMap((c) => c.tags))];
  const tagRows = tags.map((t) => {
    const rs = runs.filter(([id]) => caseOf(id).tags.includes(t)).map(([id, r]) => ({ c: caseOf(id), r }));
    const ok = rs.filter(({ c, r }) => r.verdict === c.label.verdict).length;
    return { tag: t, n: rs.length, acc: pct(ok, rs.length), avgScore: mean(rs.map(({ r }) => r.score ?? 0)).toFixed(1) };
  });

  const via = { tool: 0, text: 0, fallback: 0 };
  for (const r of all) via[r.via]++;
  const lat = all.map((r) => r.ms);
  const disagreements = runs
    .filter(([id, r]) => r.verdict !== undefined && r.verdict !== caseOf(id).label.verdict)
    .map(([id, r]) => `${id}（期望 ${caseOf(id).label.verdict}，实际 ${r.verdict} ${r.score}）`);

  const summary = {
    model: config.model,
    date: new Date().toISOString(),
    cases: cases.length,
    repeat: args.repeat,
    judgements: all.length,
    verdictAgreement: agree / Math.max(1, judged.length),
    scoreInRange: inRange / Math.max(1, judged.length),
    scoreMAE: mean(absErr),
    precisionClear: tp / Math.max(1, tp + fp),
    recallClear: tp / Math.max(1, tp + fn),
    /** 把不合格回答判成掌握——对备考工具危害最大 */
    falseClearRate: fp / Math.max(1, fp + tn),
    structuredOutputRate: (via.tool + via.text) / Math.max(1, all.length),
    via,
    stability: args.repeat > 1
      ? { meanScoreStd: mean(stability.map((s) => s.std)), verdictFlipRate: stability.filter((s) => s.flip).length / Math.max(1, stability.length) }
      : null,
    latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95) },
    tokensPerJudgement: { input: mean(all.map((r) => r.inputTokens)), output: mean(all.map((r) => r.outputTokens)) },
    avgIterations: mean(all.map((r) => r.iterations)),
    byTag: tagRows,
    disagreements,
  };

  const md = [
    `# 判分评测报告`,
    ``,
    `- 模型：\`${summary.model}\` · 日期：${summary.date.slice(0, 10)}`,
    `- 用例：${summary.cases} 条 × ${summary.repeat} 次 = ${summary.judgements} 次判分`,
    ``,
    `| 指标 | 值 |`,
    `|---|---|`,
    `| verdict 与标注一致率 | ${pct(agree, judged.length)} |`,
    `| 分数落在标注区间 | ${pct(inRange, judged.length)} |`,
    `| 分数偏离区间 MAE | ${summary.scoreMAE.toFixed(1)} |`,
    `| clear 精确率 / 召回率 | ${pct(tp, tp + fp)} / ${pct(tp, tp + fn)} |`,
    `| 误判为掌握（false clear）率 | ${pct(fp, fp + tn)} |`,
    `| 结构化输出成功率 | ${pct(via.tool + via.text, all.length)}（tool ${via.tool} / text ${via.text} / fallback ${via.fallback}） |`,
    ...(summary.stability
      ? [`| 重复判分分数标准差（均值） | ${summary.stability.meanScoreStd.toFixed(1)} |`, `| verdict 翻转率 | ${(summary.stability.verdictFlipRate * 100).toFixed(1)}% |`]
      : []),
    `| 延迟 p50 / p95 | ${(summary.latencyMs.p50 / 1000).toFixed(1)}s / ${(summary.latencyMs.p95 / 1000).toFixed(1)}s |`,
    `| 平均 token（in / out） | ${summary.tokensPerJudgement.input.toFixed(0)} / ${summary.tokensPerJudgement.output.toFixed(0)} |`,
    `| 平均 loop 轮数 | ${summary.avgIterations.toFixed(2)} |`,
    ``,
    `## 分标签`,
    ``,
    `| 标签 | 次数 | 一致率 | 平均分 |`,
    `|---|---|---|---|`,
    ...tagRows.map((t) => `| ${t.tag} | ${t.n} | ${t.acc} | ${t.avgScore} |`),
    ``,
    `## 不一致用例`,
    ``,
    ...(disagreements.length ? disagreements.map((d) => `- ${d}`) : ["（无）"]),
    ``,
  ].join("\n");

  const outDir = join(EVAL_DIR, "results");
  mkdirSync(outDir, { recursive: true });
  const stamp = summary.date.replace(/[:.]/g, "-").slice(0, 19);
  writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify({ summary, runs }, null, 2));
  writeFileSync(join(outDir, "latest.md"), md);
  console.log("\n" + md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
