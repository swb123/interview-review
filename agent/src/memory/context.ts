import type Anthropic from "@anthropic-ai/sdk";
import { chat } from "../llm/client.js";

/**
 * 会话上下文管理（面试讲点：上下文工程）。
 *
 * 分层模型：
 * - L0 身份与规则：system prompt 常量（prompts/system.ts）
 * - L1 调度状态：system prompt 里的统计快照（工具可随时刷新）
 * - L2 当前题：判分流程每题独立会话，不进这里
 * - L3 问答历史：最近 KEEP_RECENT 轮完整保留，更早轮次压缩成摘要
 *
 * 压缩策略：估计 token（文本长度/3.5 粗估，不依赖 count_tokens——
 * DeepSeek 端点未必支持该接口）超阈值或轮次超限时，把旧轮次送给 LLM
 * 摘要成 ~300 字（已练题目/薄弱点/未解决追问），摘要作为一条前置 user 消息。
 */

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

const KEEP_RECENT = 6; // 最近 6 轮完整保留（约 2~3 道题）
const MAX_TURNS_BEFORE_COMPRESS = 12;
const MAX_ESTIMATED_TOKENS = 24000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class ConversationContext {
  private turns: Turn[] = [];
  private summary = "";
  private totalTurns = 0; // 会话累计轮数（含已压缩的）

  append(role: Turn["role"], content: string): void {
    this.turns.push({ role, content });
    this.totalTurns++;
  }

  estimatedTokens(): number {
    return estimateTokens(this.summary + this.turns.map((t) => t.content).join(""));
  }

  needsCompression(): boolean {
    return this.turns.length > MAX_TURNS_BEFORE_COMPRESS ||
      this.estimatedTokens() > MAX_ESTIMATED_TOKENS;
  }

  /** 压缩旧轮次：摘要合并进前置块，窗口缩回 KEEP_RECENT 轮 */
  async compress(): Promise<void> {
    const old = this.turns.slice(0, Math.max(0, this.turns.length - KEEP_RECENT));
    const recent = this.turns.slice(-KEEP_RECENT);
    if (old.length === 0) return;
    const oldText = old
      .map((t) => `${t.role === "user" ? "用户" : "教练"}: ${t.content}`)
      .join("\n");
    this.summary = await summarize(oldText, this.summary);
    this.turns = recent;
  }

  /** 组装请求消息：摘要（若有）+ 滚动窗口 */
  toMessages(): Anthropic.MessageParam[] {
    const msgs: Anthropic.MessageParam[] = [];
    if (this.summary) {
      msgs.push({ role: "user", content: `【早前对话摘要】\n${this.summary}` });
    }
    for (const t of this.turns) {
      msgs.push({ role: t.role, content: t.content });
    }
    return msgs;
  }

  get summaryText(): string {
    return this.summary;
  }

  get turnTotal(): number {
    return this.totalTurns;
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
