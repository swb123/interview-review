import type Anthropic from "@anthropic-ai/sdk";
import { chat } from "../llm/client.js";

/**
 * 会话上下文管理（面试讲点：上下文工程）。
 *
 * 分层模型：
 * - L0 身份与规则：system prompt 常量（prompts/system.ts）
 * - L1 调度状态 + 早前对话摘要：拼进 system prompt（不占 user 轮次，
 *   避免「摘要 user 消息 + 首条 user 消息」连续两条 user 的协议问题）
 * - L2 当前题：判分流程每题独立会话，不进这里
 * - L3 问答历史：以「一问一答」为单位（exchange），含中间的 tool_use / tool_result，
 *   下一轮能看到上一轮查过什么；最近 KEEP_RECENT 个完整保留，更早的压缩成摘要
 *
 * 三种手段组合：
 * - 上下文编辑：非最新 exchange 的 tool_result 截断到 TOOL_RESULT_CLIP 字——
 *   工具结果是体积大头，且过期后价值低；tool_use/tool_result 配对保留，协议合法
 * - 滚动窗口：按 exchange 整体切分，绝不拆散 tool_use/tool_result 对
 * - LLM 摘要：旧 exchange 摘要成 ~300 字（已练题目/薄弱点/未解决追问）
 *
 * 触发条件：优先用上一次请求真实的 usage.input_tokens（最准）；拿不到时用
 * 中文感知的粗估（CJK 约 1 token/字，其他约 4 字符/token）——旧实现按
 * 「长度/3.5」估，中文会低估 3 倍左右，阈值形同虚设。
 */

type Msg = Anthropic.MessageParam;

export const KEEP_RECENT = 3; // 最近 3 个 exchange 完整保留（约 2~3 道题）
export const MAX_EXCHANGES_BEFORE_COMPRESS = 6;
export const MAX_INPUT_TOKENS = 24000;
export const TOOL_RESULT_CLIP = 300;

const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/g;

export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

/** 消息 → 纯文本（用于估算与摘要） */
export function renderMessage(m: Msg): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_use") return `[调用 ${b.name} ${JSON.stringify(b.input)}]`;
      if (b.type === "tool_result") {
        const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        return `[工具结果${b.is_error ? "(错误)" : ""} ${c}]`;
      }
      return "";
    })
    .join("\n");
}

function clipToolResults(m: Msg): Msg {
  if (typeof m.content === "string") return m;
  return {
    role: m.role,
    content: m.content.map((b) => {
      if (b.type !== "tool_result" || typeof b.content !== "string") return b;
      if (b.content.length <= TOOL_RESULT_CLIP) return b;
      return {
        ...b,
        content: b.content.slice(0, TOOL_RESULT_CLIP) + `…（已截断，原 ${b.content.length} 字）`,
      };
    }),
  };
}

export type Summarizer = (history: string, prevSummary: string) => Promise<string>;

export class ConversationContext {
  private exchanges: Msg[][] = [];
  private summary = "";
  private totalExchanges = 0;
  private lastInputTokens = 0;

  constructor(private readonly summarizer: Summarizer = summarize) {}

  /** 开启一个新 exchange（用户发言） */
  beginExchange(userText: string): void {
    this.exchanges.push([{ role: "user", content: userText }]);
    this.totalExchanges++;
  }

  /** 把本轮 loop 产生的 assistant/tool_result 消息与最终回复并入当前 exchange */
  completeExchange(messages: Msg[]): void {
    const cur = this.exchanges[this.exchanges.length - 1];
    if (!cur) throw new Error("completeExchange 之前必须 beginExchange");
    cur.push(...messages);
  }

  /** 记录真实 usage（来自 LoopStats），用于下一次压缩判定 */
  recordUsage(inputTokens: number): void {
    if (inputTokens > 0) this.lastInputTokens = inputTokens;
  }

  estimatedTokens(): number {
    const text = this.summary + this.toMessages().map(renderMessage).join("");
    return Math.max(estimateTokens(text), this.lastInputTokens);
  }

  needsCompression(): boolean {
    return this.exchanges.length > MAX_EXCHANGES_BEFORE_COMPRESS ||
      (this.exchanges.length > KEEP_RECENT && this.estimatedTokens() > MAX_INPUT_TOKENS);
  }

  /** 压缩旧 exchange：摘要合并，窗口缩回 KEEP_RECENT 个 */
  async compress(): Promise<void> {
    const cut = Math.max(0, this.exchanges.length - KEEP_RECENT);
    const old = this.exchanges.slice(0, cut);
    if (old.length === 0) return;
    const oldText = old
      .flat()
      .map((m) => `${m.role === "user" ? "用户" : "教练"}: ${renderMessage(clipToolResults(m))}`)
      .join("\n");
    this.summary = await this.summarizer(oldText, this.summary);
    this.exchanges = this.exchanges.slice(cut);
    this.lastInputTokens = 0; // 压缩后真实用量已失效，下一次请求重新记录
  }

  /** 组装请求消息：滚动窗口；非最新 exchange 的工具结果做截断编辑 */
  toMessages(): Msg[] {
    const out: Msg[] = [];
    this.exchanges.forEach((ex, i) => {
      const isLatest = i === this.exchanges.length - 1;
      for (const m of ex) out.push(isLatest ? m : clipToolResults(m));
    });
    return out;
  }

  get summaryText(): string {
    return this.summary;
  }

  get exchangeTotal(): number {
    return this.totalExchanges;
  }
}

async function summarize(history: string, prevSummary: string): Promise<string> {
  const { message } = await chat({
    system:
      "你是会话摘要器。把面试陪练对话压缩成 300 字以内的中文摘要，保留三件事：已练过的题目及掌握情况、用户暴露的薄弱知识点、未解决的追问。只输出摘要正文，不要任何前缀。",
    messages: [
      {
        role: "user",
        content: `已有摘要：\n${prevSummary || "（无）"}\n\n新对话片段：\n${history}\n\n请输出合并后的新摘要：`,
      },
    ],
    maxTokens: 1024,
  });
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
