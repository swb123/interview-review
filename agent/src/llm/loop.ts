import type Anthropic from "@anthropic-ai/sdk";
import { chat as defaultChat, toMessageContent } from "./client.js";
import type { ChatResult } from "./client.js";

/**
 * 手写 agent loop（面试核心展示点）。
 *
 * 设计要点：
 * - 循环条件：以 content 是否含 tool_use 块为准——stop_reason 枚举不可信
 *   （DeepSeek 兼容端点可能返回非标准值），不匹配时按块类型防御性判定
 * - 并行工具执行：所有 tool_use 并发执行（Promise.all），结果合并在同一条
 *   user 消息回填（Anthropic 规范：拆开回填会训练模型少发并行调用）
 * - 工具失败不回抛：回填 is_error:true 的结果，模型自行决定降级或换工具
 * - max_tokens 截断恢复：
 *   · 无工具调用 → 回填已输出的 assistant 部分 + 「请继续」，消耗一轮迭代预算
 *   · 有工具调用 → 最后一个 tool_use 的入参可能不完整，不执行，按 is_error 回填
 *     「请重新调用」；前面完整的照常执行。全部结果仍在同一条 user 消息里，
 *     不产生连续两条 user 消息（部分兼容端点对此直接 400）
 * - 护栏：maxIterations 上限（默认 8），超出返回 kind:"max_iterations"，
 *   由调用方决定降级文案，不抛异常（最后一轮的部分输出仍可展示）
 * - 可观测性：轮数/耗时/token 用量/工具调用明细累计回传；onTrace 供落盘
 */

export interface ToolCallStat {
  name: string;
  ok: boolean;
  ms: number;
}

export interface LoopStats {
  iterations: number;
  totalElapsedMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** 最后一轮请求的 input_tokens ≈ 当前上下文体积（供压缩判定） */
  lastInputTokens: number;
  toolCalls: ToolCallStat[];
  /** 被 max_tokens 截断的轮数 */
  truncations: number;
}

export interface LoopResult {
  kind: "end" | "max_iterations";
  message: Anthropic.Message;
  stats: LoopStats;
}

export type ChatFn = (opts: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}) => Promise<ChatResult>;

export const TRUNCATED_TOOL_ERROR =
  "ERROR: 上一轮输出被 max_tokens 截断，本次工具调用参数可能不完整，未执行。请精简输出后重新调用。";

export async function runAgentLoop(opts: {
  system: string;
  tools: Anthropic.Tool[];
  /** 会被原地追加（assistant/tool_result 轮），调用方可据此保留完整轨迹 */
  messages: Anthropic.MessageParam[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxIterations?: number;
  maxTokens?: number;
  onToolUse?: (name: string, input: Record<string, unknown>, ok: boolean, ms: number) => void;
  /** 依赖注入：单测替换为 mock，生产走 client.chat */
  chat?: ChatFn;
}): Promise<LoopResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const chat = opts.chat ?? defaultChat;
  const t0 = Date.now();
  const stats: LoopStats = {
    iterations: 0,
    totalElapsedMs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastInputTokens: 0,
    toolCalls: [],
    truncations: 0,
  };
  let last: Anthropic.Message | null = null;

  for (let i = 0; i < maxIterations; i++) {
    stats.iterations = i + 1;
    const { message } = await chat({
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      maxTokens: opts.maxTokens,
    });
    last = message;
    // usage 可能缺失（端点差异）
    stats.lastInputTokens = message.usage?.input_tokens ?? 0;
    stats.totalInputTokens += stats.lastInputTokens;
    stats.totalOutputTokens += message.usage?.output_tokens ?? 0;
    const truncated = message.stop_reason === "max_tokens";
    if (truncated) stats.truncations++;

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      if (truncated) {
        // 无工具调用却被截断：回填已输出部分 + 续写指令（assistant/user 交替，协议合法）
        const partial = toMessageContent(message.content);
        if (partial.length > 0) {
          opts.messages.push({ role: "assistant", content: partial });
        }
        opts.messages.push({
          role: "user",
          content: "（上一轮输出被 max_tokens 截断）请继续未完成的部分，不要重复已输出的内容。",
        });
        continue;
      }
      // end_turn / stop_sequence / 未知停止原因：无工具调用即结束
      stats.totalElapsedMs = Date.now() - t0;
      return { kind: "end", message, stats };
    }

    // 回填 assistant 轮（剥离 thinking 块）
    opts.messages.push({ role: "assistant", content: toMessageContent(message.content) });

    // 截断时最后一个 tool_use 的入参可能不完整：不执行
    const suspect = truncated ? toolUses[toolUses.length - 1].id : null;

    // 并行执行全部工具调用；失败回填 is_error，不丢弃
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.ToolResultBlockParam> => {
        const input = (typeof tu.input === "object" && tu.input !== null
          ? tu.input
          : {}) as Record<string, unknown>;
        if (tu.id === suspect) {
          stats.toolCalls.push({ name: tu.name, ok: false, ms: 0 });
          opts.onToolUse?.(tu.name, input, false, 0);
          return { type: "tool_result", tool_use_id: tu.id, content: TRUNCATED_TOOL_ERROR, is_error: true };
        }
        const s = Date.now();
        let ok = true;
        let content: string;
        try {
          content = await opts.executeTool(tu.name, input);
        } catch (err) {
          ok = false;
          content = `ERROR: ${(err as Error).message}`;
        }
        const ms = Date.now() - s;
        stats.toolCalls.push({ name: tu.name, ok, ms });
        opts.onToolUse?.(tu.name, input, ok, ms);
        return { type: "tool_result", tool_use_id: tu.id, content, is_error: !ok };
      }),
    );
    opts.messages.push({ role: "user", content: results });
  }

  stats.totalElapsedMs = Date.now() - t0;
  if (!last) {
    throw new Error("maxIterations 必须 >= 1");
  }
  return { kind: "max_iterations", message: last, stats };
}

/** 从响应中取出纯文本（多个 text 块用换行拼接） */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
