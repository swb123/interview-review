import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { config } from "./config.js";
import { inCategory, listCategories, loadBank } from "./data/questions.js";
import type { Question, QuestionBank } from "./data/questions.js";
import { loadProgress, updateProgress } from "./memory/progress.js";
import { ConversationContext } from "./memory/context.js";
import { buildCoachSystem } from "./prompts/system.js";
import { applyResult, buildTodayQueue, buildWrongBook, computeStats } from "./scheduler/scheduler.js";
import { judge } from "./judge/judge.js";
import type { Judgement } from "./judge/schema.js";
import { runAgentLoop } from "./llm/loop.js";
import { createToolRegistry } from "./tools/registry.js";

// ANSI 常量（不引 chalk：四个常量足够）
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const rl = createInterface({ input, output });
const lineIter = rl[Symbol.asyncIterator]();

/**
 * 读取一行。不用 rl.question()：它在管道（非 TTY）模式下只有第一次调用有效，
 * 后续会挂起且 EOF 不返回——node readline 的已知怪癖。
 * 自封装（写提示 + 异步迭代器取行）在 TTY 与管道下行为一致，EOF 确定性返回空串。
 */
async function question(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const res = await lineIter.next();
  return res.done ? "" : res.value;
}

interface CliArgs {
  category?: string;
  count?: number;
  dryRun: boolean;
  agentic: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, agentic: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--agentic") args.agentic = true;
    else if (a === "--category") args.category = argv[++i];
    else if (a === "--count") args.count = Number.parseInt(argv[++i] ?? "", 10);
    else if (a === "--help" || a === "-h") {
      console.log(`用法: npm start [--category 分类名] [--count N] [--dry-run] [--agentic]
  --category  直接刷指定分类（如 "十一、Agent 基础与架构"），跳过主菜单
  --count     限制本次题数
  --dry-run   判分照常但不写 progress.json（冒烟/试玩用）
  --agentic   直接进入答疑模式（自由对话，展示完整 agent loop + 工具调用）`);
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// 交互输入
// ---------------------------------------------------------------------------

/** 多行输入：空行结束；首行空输入继续等待；skip/exit 快捷命令 */
async function readMultiline(): Promise<string> {
  const lines: string[] = [];
  while (true) {
    const line = await question(C.green + "✍  " + C.reset);
    const t = line.trim();
    if (t === "") {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(line);
    if (t === "skip" || t === "exit") break;
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// 判分结果展示与进度记录
// ---------------------------------------------------------------------------

function printJudgement(j: Judgement): void {
  const badge = j.verdict === "clear"
    ? C.green + "✓ 掌握" + C.reset
    : C.red + "✗ 未掌握" + C.reset;
  console.log(`\n${C.bold}判分结果${C.reset} ${badge} ${C.bold}${j.score}/100${C.reset}`);
  if (j.covered_points.length > 0) {
    console.log(C.green + "答到的要点：" + C.reset + j.covered_points.join("；"));
  }
  if (j.missed_points.length > 0) {
    console.log(C.red + "遗漏/答错的要点：" + C.reset + j.missed_points.join("；"));
  }
  console.log(C.cyan + "讲解：" + C.reset + "\n" + j.explanation);
  console.log(C.dim + "建议：" + j.suggestion + C.reset);
}

async function promptRecord(
  q: Question,
  judgement: Judgement | undefined,
  dryRun: boolean,
): Promise<"clear" | "unclear" | "skip"> {
  const rec = (await question("记录进度？(y=按判分标记 / n=手动标记 / s=跳过) ")).trim();
  if (rec === "s") {
    console.log(C.dim + "已跳过。" + C.reset);
    return "skip";
  }
  let result: "clear" | "unclear";
  if (rec === "y") {
    if (!judgement) {
      const m = (await question("无判分结果，手动标记 clear/unclear？(c/u) ")).trim();
      result = m === "u" ? "unclear" : "clear";
    } else {
      result = judgement.verdict;
    }
  } else {
    const m = (await question("标记为 clear 或 unclear？(c/u) ")).trim();
    result = m === "u" ? "unclear" : "clear";
  }
  if (dryRun) {
    console.log(C.dim + `[dry-run] 未落盘（${result}）。` + C.reset);
  } else {
    const e = updateProgress(q.id, (x) => applyResult(q.id, x, result, new Date()));
    console.log(
      C.dim + `已记录 ${result}：间隔 ${e.intervalDays} 天，下次复习 ${e.nextReviewDate.slice(0, 10)}。` + C.reset,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// 练题流程（确定性代码编排，LLM 只做判分）
// ---------------------------------------------------------------------------

async function runQuiz(bank: QuestionBank, questions: Question[], dryRun: boolean): Promise<void> {
  if (questions.length === 0) {
    console.log(C.yellow + "队列为空（没有待复习的题）。" + C.reset);
    return;
  }
  console.log(
    C.cyan + `本次共 ${questions.length} 道题。多行输入回答，空行结束；skip 跳过，exit 退出。` + C.reset,
  );
  let cleared = 0;
  let unclear = 0;
  let skipped = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`\n${C.bold}【${i + 1}/${questions.length}】${q.category} · ${q.number}${C.reset}`);
    console.log(C.yellow + q.question + C.reset);
    const answer = await readMultiline();
    if (answer === "exit") {
      console.log(C.dim + "已退出本次复习。" + C.reset);
      break;
    }
    if (answer === "skip") {
      skipped++;
      console.log(C.dim + "已跳过。" + C.reset);
      continue;
    }

    console.log(C.dim + "判分中…" + C.reset);
    const result = await judge(
      { bank },
      { questionId: q.id, userAnswer: answer },
      (name, _input, ok, ms) => {
        if (name !== "submit_judgement") {
          console.log(C.dim + `  ⚙ ${name}${ok ? "" : " ✗"} (${ms}ms)` + C.reset);
        }
      },
    );

    if (result.via === "fallback") {
      console.log(C.red + "判分通道不可用，直接显示标准答案：" + C.reset);
      console.log(C.dim + q.answer + C.reset);
      const r = await promptRecord(q, undefined, dryRun);
      if (r === "clear") cleared++;
      else if (r === "unclear") unclear++;
      else skipped++;
      continue;
    }

    printJudgement(result.judgement);
    console.log(C.dim + `（判分通道：${result.via}）` + C.reset);
    const r = await promptRecord(q, result.judgement, dryRun);
    if (r === "clear") cleared++;
    else if (r === "unclear") unclear++;
    else skipped++;
  }

  const stats = computeStats(loadProgress(), bank.questions.length);
  console.log(C.bold + `\n本次：掌握 ${cleared} / 未掌握 ${unclear} / 跳过 ${skipped}` + C.reset);
  console.log(
    C.dim + `累计：已学 ${stats.reviewed} / 错题 ${stats.wrong} / 掌握 ${stats.mastered}（题库 ${stats.total}）` + C.reset,
  );
}

async function todayReview(bank: QuestionBank, args: CliArgs): Promise<void> {
  const progress = loadProgress();
  const { newIntro, due } = buildTodayQueue(bank, progress, new Date());
  console.log(`今日队列：新题 ${newIntro.length} + 到期复习 ${due.length}`);
  await runQuiz(bank, [...newIntro, ...due], args.dryRun);
}

async function byCategory(bank: QuestionBank, args: CliArgs): Promise<void> {
  const cats = listCategories(bank);
  let category = args.category;
  if (!category) {
    cats.forEach((c, i) => console.log(`${i + 1}. ${c}（${inCategory(bank, c).length} 题）`));
    const sel = (await question("选择分类编号：")).trim();
    const idx = Number.parseInt(sel, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= cats.length) {
      console.log(C.red + "无效选择。" + C.reset);
      return;
    }
    category = cats[idx];
  } else if (!cats.includes(category)) {
    console.log(C.red + `分类不存在: ${category}` + C.reset);
    console.log("可选分类：" + cats.join(" / "));
    return;
  }
  const pool = inCategory(bank, category);
  const questions = args.count !== undefined ? pool.slice(0, args.count) : pool;
  console.log(`分类「${category}」共 ${pool.length} 题，本次 ${questions.length} 题。`);
  await runQuiz(bank, questions, args.dryRun);
}

function showWrongBook(bank: QuestionBank): void {
  const entries = buildWrongBook(bank, loadProgress());
  if (entries.length === 0) {
    console.log(C.green + "错题本为空，继续保持！" + C.reset);
    return;
  }
  entries.forEach((e, i) => {
    console.log(`${i + 1}. [${C.red}${e.unclearCount}错${C.reset}·${e.clearCount}对] ${e.question.id}`);
    console.log(`   ${e.question.question}`);
  });
}

function showStats(bank: QuestionBank): void {
  const progress = loadProgress();
  const s = computeStats(progress, bank.questions.length);
  const { newIntro, due } = buildTodayQueue(bank, progress, new Date());
  console.log(
    [
      `题库：${s.total} 题`,
      `已学：${s.reviewed}`,
      `错题：${s.wrong}`,
      `已掌握：${s.mastered}`,
      `今日：新题 ${newIntro.length} + 到期复习 ${due.length}`,
    ].join(C.bold + "  |  " + C.reset),
  );
}

// ---------------------------------------------------------------------------
// 答疑模式（agentic：完整 loop + 全部导航工具）
// ---------------------------------------------------------------------------

async function chatMode(bank: QuestionBank): Promise<void> {
  const ctx = new ConversationContext();
  const registry = createToolRegistry({ bank, revealAnswer: false });
  const progress = loadProgress();
  const system = buildCoachSystem({
    stats: computeStats(progress, bank.questions.length),
  });
  console.log(C.cyan + "答疑模式：自由对话，可问知识点、可让教练出题。输入 exit 返回主菜单。" + C.reset);
  while (true) {
    const line = (await question(C.green + "你> " + C.reset)).trim();
    if (line === "exit") break;
    if (line === "") continue;
    ctx.append("user", line);
    if (ctx.needsCompression()) {
      console.log(C.dim + "压缩历史上下文…" + C.reset);
      await ctx.compress();
    }
    const result = await runAgentLoop({
      system,
      tools: registry.schemas,
      messages: ctx.toMessages(),
      executeTool: registry.execute,
      maxIterations: 8,
      onToolUse: (name, _input, ok, ms) => {
        console.log(C.dim + `  ⚙ ${name}${ok ? "" : " ✗"} (${ms}ms)` + C.reset);
      },
    });
    const text = result.message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    console.log(C.magenta + "教练> " + C.reset + (text || C.dim + "（无文本输出）" + C.reset));
    if (text) ctx.append("assistant", text);
    if (result.kind === "max_iterations") {
      console.log(C.dim + "[护栏] 达到最大轮次。" + C.reset);
    }
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bank = loadBank();
  console.log(
    C.dim + `题库 v${bank.version}（${bank.questions.length} 题）· 模型 ${config.model}${args.dryRun ? " · dry-run" : ""}` + C.reset,
  );
  if (!config.authToken) {
    console.log(
      C.yellow + "提示：未检测到 ANTHROPIC_AUTH_TOKEN，判分/答疑将不可用（浏览与 dry-run 不受影响）。" + C.reset,
    );
  }

  if (args.agentic) {
    await chatMode(bank);
    rl.close();
    return;
  }
  if (args.category) {
    await byCategory(bank, args);
    rl.close();
    return;
  }

  while (true) {
    console.log(
      [
        "",
        `${C.bold}面试陪练 agent${C.reset}`,
        "  1. 今日复习（agent 专题优先 + 到期题）",
        "  2. 刷指定分类",
        "  3. 错题本",
        "  4. 统计",
        "  5. 答疑（自由对话）",
        "  0. 退出",
      ].join("\n"),
    );
    const sel = (await question("选择：")).trim();
    switch (sel) {
      case "1":
        await todayReview(bank, args);
        break;
      case "2":
        await byCategory(bank, args);
        break;
      case "3":
        showWrongBook(bank);
        break;
      case "4":
        showStats(bank);
        break;
      case "5":
        await chatMode(bank);
        break;
      case "0":
        console.log("再见！");
        rl.close();
        return;
      default:
        console.log(C.red + "无效选择。" + C.reset);
    }
  }
}

main().catch((err) => {
  console.error(C.red + (err as Error).message + C.reset);
  process.exit(1);
});
