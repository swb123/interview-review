import type Anthropic from "@anthropic-ai/sdk";
import { chat, toMessageContent } from "./client.js";

/**
 * 手写 agent loop（面试核心展示点）。
 *
 * 设计要点：
 * - 循环条件：以 content 是否含 tool_use 块为准——stop_reason 枚举不可信
 *   （DeepSeek 兼容端点可能返回非标准值），不匹配时按块类型防御性判定
 * - 并行工具执行：所有 tool_use 并发执行（Promise.all），结果合并在同一条
 *   user 消息回填（Anthropic 规范：拆开回填会训练模型少发并行调用）
 * - 工具失败不回抛：回填 is_error:true 的结果，模型自行决定降级或换工具
 * - max_tokens 截断恢复：回填可用部分 + 「请继续」指令，消耗一轮迭代预算
 * - 护栏：maxIterations 上限（默认 8），超出抛 LoopLimitError
 * - 可观测性：轮数/耗时/token 用量累计回传，供 CLI 打印
 */

export interface LoopStats {
  iterations: number;
  totalElapsedMs: number;
  totalOutputTokens: number;
  toolCalls: { name: string; ok: boolean; ms: number }[];
}

export interface LoopResult {
  kind: "end" | "max_iterations";
  message: Anthropic.Message;
  stats: LoopStats;
}

export class LoopLimitError extends Error {
  constructor(iterations: number) {
    super(`agent loop 超过 ${iterations} 轮上限（护栏触发）`);
    this.name = "LoopLimitError";
  }
}

export async function runAgentLoop(opts: {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxIterations?: number;
  maxTokens?: number;
  onToolUse?: (name: string, input: Record<string, unknown>, ok: boolean, ms: number) => void;
}): Promise<LoopResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const t0 = Date.now();
  const stats: LoopStats = {
    iterations: 0,
    totalElapsedMs: 0,
    totalOutputTokens: 0,
    toolCalls: [],
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
    stats.totalOutputTokens += message.usage?.output_tokens ?? 0; // usage 可能缺失（端点差异）

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      if (message.stop_reason === "max_tokens") {
        // 无工具调用却被截断：请求续写，消耗本轮预算
        opts.messages.push({
          role: "user",
          content: "（上一轮输出被 max_tokens 截断）请继续未完成的部分。",
        });
        continue;
      }
      // end_turn / stop_sequence / 未知停止原因：无工具调用即结束
      stats.totalElapsedMs = Date.now() - t0;
      return { kind: "end", message, stats };
    }

    // 回填 assistant 轮（剥离 thinking 块）
    opts.messages.push({ role: "assistant", content: toMessageContent(message.content) });

    // 并行执行全部工具调用；失败回填 is_error，不丢弃
    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const s = Date.now();
        let ok = true;
        let content: string;
        try {
          const input = (typeof tu.input === "object" && tu.input !== null
            ? tu.input
            : {}) as Record<string, unknown>;
          content = await opts.executeTool(tu.name, input);
        } catch (err) {
          ok = false;
          content = `ERROR: ${(err as Error).message}`;
        }
        const ms = Date.now() - s;
        stats.toolCalls.push({ name: tu.name, ok, ms });
        opts.onToolUse?.(tu.name, tu.input as Record<string, unknown>, ok, ms);
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content,
          is_error: !ok,
        };
      }),
    );
    opts.messages.push({ role: "user", content: results });

    if (message.stop_reason === "max_tokens") {
      // 有工具调用但输出被截断（工具入参可能不完整，已按错误回填）→ 续写
      opts.messages.push({
        role: "user",
        content: "（输出被截断）请继续未完成的部分。",
      });
    }
  }

  stats.totalElapsedMs = Date.now() - t0;
  if (!last) {
    throw new LoopLimitError(maxIterations);
  }
  return { kind: "max_iterations", message: last, stats };
}
