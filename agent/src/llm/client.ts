import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client: Anthropic | null = null;

/** 惰性构造 SDK 客户端（复用 DeepSeek Anthropic 兼容端点配置） */
export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      baseURL: config.baseURL,
      authToken: config.authToken,
      maxRetries: 2, // SDK 内置重试：408/409/429/5xx + 连接错误，指数退避
    });
  }
  return client;
}

/**
 * 响应块 → 可回填的 assistant 消息内容。
 * 防御性剥离：只保留 text / tool_use，丢弃 thinking（DeepSeek 端点默认开思考模式，
 * 回传思考块可能直接 400）。ECHO_THINKING=true 时保留思考块（实验开关）。
 */
export function toMessageContent(
  blocks: Anthropic.ContentBlock[],
  echoThinking: boolean = config.echoThinking,
): Anthropic.ContentBlockParam[] {
  const out: Anthropic.ContentBlockParam[] = [];
  for (const b of blocks) {
    if (b.type === "text") {
      out.push({ type: "text", text: b.text });
    } else if (b.type === "tool_use") {
      // 截断场景下 input 可能不是合法对象：替换为 {} 保证请求合法性，执行时走错误回填
      const input =
        typeof b.input === "object" && b.input !== null ? b.input : {};
      out.push({
        type: "tool_use",
        id: b.id,
        name: b.name,
        input: input as Record<string, unknown>,
      });
    } else if ((b.type === "thinking" || b.type === "redacted_thinking") && echoThinking) {
      out.push(b as unknown as Anthropic.ContentBlockParam);
    }
    // 其他未知块类型：防御性丢弃
  }
  return out;
}

export interface ChatResult {
  message: Anthropic.Message;
  elapsedMs: number;
}

/** 单次 LLM 调用（非流式，MVP 最稳；判分输出不长，无需流式） */
export async function chat(opts: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}): Promise<ChatResult> {
  const t0 = Date.now();
  try {
    const message = await getClient().messages.create({
      model: config.model,
      max_tokens: opts.maxTokens ?? config.chatMaxTokens,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
    });
    return { message, elapsedMs: Date.now() - t0 };
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      // 400 不重试：大概率是端点兼容性问题，打印请求摘要便于定位
      console.error(
        "[llm] BadRequest 排查信息:",
        JSON.stringify(
          {
            model: config.model,
            baseURL: config.baseURL,
            toolNames: opts.tools?.map((t) => t.name),
            messageRoles: opts.messages.map((m) => m.role),
            systemLen: opts.system.length,
          },
          null,
          2,
        ),
      );
    }
    throw err;
  }
}
