import { config } from "../src/config.js";
import { loadBank } from "../src/data/questions.js";
import { judge } from "../src/judge/judge.js";

/**
 * LLM 行为探针：单次判分调用，打印原始响应形态（stop_reason、content 块类型序列、
 * usage、判分通道），用于一次性确认 DeepSeek 兼容端点对 thinking 块 / tool_use /
 * 并行调用的实际行为，据此微调 loop 里的防御开关。
 *
 * 用法：npm run smoke [questionId]
 */

async function main(): Promise<void> {
  const bank = loadBank();
  const questionId = process.argv[2] ?? bank.questions[0]?.id;
  if (!questionId) {
    console.error("题库为空");
    process.exit(1);
  }
  console.log(`模型: ${config.model}\n端点: ${config.baseURL}\n题目: ${questionId}\n`);

  const t0 = Date.now();
  const toolTrace: string[] = [];
  const result = await judge(
    { bank },
    {
      questionId,
      userAnswer:
        "（探针测试回答）不太确定，印象里跟工具调用和循环有关，但具体细节记不清了。",
    },
    (name, _input, ok, ms) => {
      toolTrace.push(`${name}${ok ? "" : " ✗"} (${ms}ms)`);
    },
  );

  console.log(`耗时: ${Date.now() - t0}ms`);
  console.log(`工具调用轨迹: ${toolTrace.join(" → ") || "（无）"}`);
  if (result.via === "fallback") {
    console.log("判分通道: fallback（三保险全失败）");
  } else {
    console.log(`判分通道: ${result.via}`);
    const j = result.judgement;
    console.log(`verdict: ${j.verdict}  score: ${j.score}`);
    console.log(`覆盖点(${j.covered_points.length}): ${j.covered_points.join("；") || "无"}`);
    console.log(`遗漏点(${j.missed_points.length}): ${j.missed_points.join("；") || "无"}`);
    console.log(`讲解: ${j.explanation.slice(0, 200)}${j.explanation.length > 200 ? "…" : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
