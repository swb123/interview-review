import type Anthropic from "@anthropic-ai/sdk";
import type { QuestionBank } from "../data/questions.js";
import { config } from "../config.js";
import { runAgentLoop } from "../llm/loop.js";
import { createToolRegistry } from "../tools/registry.js";
import { JUDGE_SYSTEM_PROMPT, JudgementSchema } from "./schema.js";
import type { Judgement } from "./schema.js";

/**
 * 判分子流程：每题独立会话（子 agent 上下文隔离——不带主会话历史，
 * 压缩压力减半，成本可控），内部跑一次 mini agent loop：
 *   取题 → get_question（含标准答案的内部通道）→ submit_judgement 结构化输出。
 *
 * 结构化输出三保险：
 * ① submit_judgement 工具调用（不依赖 tool_choice forced——DeepSeek 支持未知）
 * ② 文本 ```json 围栏提取 + zod 校验
 * ③ 全失败 → fallback：由调用方显示标准答案 + 用户自评（零 LLM 仍可用）
 */

export type JudgeResult =
  | { via: "tool" | "text"; judgement: Judgement }
  | { via: "fallback" };

export async function judge(
  deps: { bank: QuestionBank; progressPath?: string },
  input: { questionId: string; userAnswer: string },
  onToolUse?: (name: string, input: Record<string, unknown>, ok: boolean, ms: number) => void,
): Promise<JudgeResult> {
  const question = deps.bank.questions.find((q) => q.id === input.questionId);
  if (!question) {
    return { via: "fallback" };
  }

  let captured: unknown = null;
  const registry = createToolRegistry(
    { bank: deps.bank, progressPath: deps.progressPath, revealAnswer: true },
    (raw) => {
      captured = raw; // 通道 ①：handler 侧捕获（loop 内即拿到）
    },
  );

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        `题目 ID：${input.questionId}`,
        `题目：${question.question}`,
        `用户回答：\n${input.userAnswer}`,
        `请先调用 get_question 获取标准答案，对照评估后调用 submit_judgement 提交判分。`,
      ].join("\n\n"),
    },
  ];

  const result = await runAgentLoop({
    system: JUDGE_SYSTEM_PROMPT,
    tools: registry.schemas,
    messages,
    executeTool: registry.execute,
    maxIterations: 4,
    maxTokens: config.judgeMaxTokens,
    onToolUse,
  });

  // 通道 ①：handler 捕获的 submit_judgement 输入
  const capturedParsed = JudgementSchema.safeParse(captured);
  if (capturedParsed.success) {
    return { via: "tool", judgement: capturedParsed.data };
  }

  // 通道 ①补：loop 结束时最后一轮仍带 submit_judgement 工具调用（未执行到）
  const lastToolSubmit = result.message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_judgement",
  );
  if (lastToolSubmit) {
    const parsed = JudgementSchema.safeParse(lastToolSubmit.input);
    if (parsed.success) {
      return { via: "tool", judgement: parsed.data };
    }
  }

  // 通道 ②：文本 JSON 围栏
  const text = result.message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const parsed = JudgementSchema.safeParse(JSON.parse(fence[1]));
      if (parsed.success) {
        return { via: "text", judgement: parsed.data };
      }
    } catch {
      // 解析失败 → 继续兜底
    }
  }

  return { via: "fallback" };
}
