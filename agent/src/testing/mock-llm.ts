import type Anthropic from "@anthropic-ai/sdk";
import type { ChatFn } from "../llm/loop.js";

/**
 * 测试工具：脚本化的假 LLM。
 * 按顺序返回预设响应，并记录每次请求收到的 messages 快照，用于断言协议合法性。
 */

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id?: string; name: string; input: unknown };

let seq = 0;

export function msg(
  blocks: Block[],
  stop: Anthropic.Message["stop_reason"] = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
  usage = { input_tokens: 100, output_tokens: 20 },
): Anthropic.Message {
  return {
    id: `msg_${++seq}`,
    type: "message",
    role: "assistant",
    model: "mock",
    content: blocks.map((b) =>
      b.type === "tool_use" ? { ...b, id: b.id ?? `tu_${++seq}` } : { ...b, citations: null },
    ),
    stop_reason: stop,
    stop_sequence: null,
    usage,
  } as unknown as Anthropic.Message;
}

export const text = (t: string): Block => ({ type: "text", text: t });
export const toolUse = (name: string, input: unknown, id?: string): Block => ({ type: "tool_use", name, input, id });

export interface MockChat {
  chat: ChatFn;
  /** 每次调用时 messages 的深拷贝 */
  calls: Anthropic.MessageParam[][];
  systems: string[];
}

/** responses 可以是固定消息，也可以是根据当前 messages 动态生成的函数 */
export function mockChat(
  responses: (Anthropic.Message | ((messages: Anthropic.MessageParam[]) => Anthropic.Message))[],
): MockChat {
  const calls: Anthropic.MessageParam[][] = [];
  const systems: string[] = [];
  let i = 0;
  const chat: ChatFn = async (opts) => {
    calls.push(structuredClone(opts.messages));
    systems.push(opts.system);
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    const message = typeof r === "function" ? r(opts.messages) : r;
    return { message, elapsedMs: 1 };
  };
  return { chat, calls, systems };
}

/** 协议合法性：user/assistant 严格交替，首条为 user，每个 tool_use 都有对应 tool_result */
export function assertProtocol(messages: Anthropic.MessageParam[]): string | null {
  if (messages[0]?.role !== "user") return "首条消息必须是 user";
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === messages[i - 1].role) return `第 ${i} 条与前一条角色相同（${messages[i].role}）`;
  }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const ids = m.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id);
    if (ids.length === 0) continue;
    const next = messages[i + 1];
    const got = next && typeof next.content !== "string"
      ? next.content.filter((b) => b.type === "tool_result").map((b) => (b as { tool_use_id: string }).tool_use_id)
      : [];
    for (const id of ids) {
      if (!got.includes(id)) return `tool_use ${id} 缺少对应的 tool_result`;
    }
  }
  return null;
}
