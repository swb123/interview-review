import { percentile, readTraces, tracePath } from "../src/observability/trace.js";

/**
 * trace 聚合报告：按模式统计次数、轮数、延迟分位、token、工具成功率、判分通道分布。
 * 用法：npm run trace:report [-- --since 2026-09-01]
 */

const sinceIdx = process.argv.indexOf("--since");
const since = sinceIdx >= 0 ? process.argv[sinceIdx + 1] : undefined;
const traces = readTraces().filter((t) => !since || t.ts >= since);

if (traces.length === 0) {
  console.log(`暂无 trace（${tracePath()}）`);
  process.exit(0);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const modes = [...new Set(traces.map((t) => t.mode))];

console.log(`trace: ${tracePath()} · ${traces.length} 条${since ? ` · since ${since}` : ""}\n`);
console.log("| 模式 | 次数 | 平均轮数 | p50 | p95 | 平均 in/out tokens | 截断 | 护栏触发 |");
console.log("|---|---|---|---|---|---|---|---|");
for (const m of modes) {
  const ts = traces.filter((t) => t.mode === m);
  const lat = ts.map((t) => t.elapsedMs);
  console.log(
    `| ${m} | ${ts.length} | ${mean(ts.map((t) => t.iterations)).toFixed(2)} | ${(percentile(lat, 50) / 1000).toFixed(1)}s | ${(percentile(lat, 95) / 1000).toFixed(1)}s | ${mean(ts.map((t) => t.inputTokens)).toFixed(0)} / ${mean(ts.map((t) => t.outputTokens)).toFixed(0)} | ${ts.filter((t) => t.truncations > 0).length} | ${ts.filter((t) => t.kind === "max_iterations").length} |`,
  );
}

const judged = traces.filter((t) => t.via);
if (judged.length) {
  const via = { tool: 0, text: 0, fallback: 0 };
  for (const t of judged) via[t.via!]++;
  console.log(`\n判分通道：tool ${via.tool} / text ${via.text} / fallback ${via.fallback}（结构化成功率 ${(((via.tool + via.text) / judged.length) * 100).toFixed(1)}%）`);
}

const tools = new Map<string, { n: number; fail: number; ms: number[] }>();
for (const t of traces) {
  for (const c of t.tools) {
    const s = tools.get(c.name) ?? { n: 0, fail: 0, ms: [] };
    s.n++;
    if (!c.ok) s.fail++;
    s.ms.push(c.ms);
    tools.set(c.name, s);
  }
}
if (tools.size) {
  console.log("\n| 工具 | 调用 | 失败率 | 平均耗时 |");
  console.log("|---|---|---|---|");
  for (const [name, s] of [...tools.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`| ${name} | ${s.n} | ${((s.fail / s.n) * 100).toFixed(1)}% | ${mean(s.ms).toFixed(0)}ms |`);
  }
}
