import type Anthropic from "@anthropic-ai/sdk";
import { createHandlers } from "./handlers.js";
import type { HandlerDeps, ToolHandler } from "./handlers.js";
import { SUBMIT_JUDGEMENT_TOOL } from "../judge/schema.js";

/**
 * 工具注册表：schema 列表（注入 LLM 请求）+ 按名分发执行。
 * judge 模式额外注册 submit_judgement，命中时经 judgeSubmit 回调捕获结构化判分。
 */

export interface ToolRegistry {
  schemas: Anthropic.Tool[];
  execute: (name: string, input: Record<string, unknown>) => Promise<string>;
  has: (name: string) => boolean;
}

export function createToolRegistry(
  deps: HandlerDeps,
  judgeSubmit?: (input: Record<string, unknown>) => void,
): ToolRegistry {
  const handlers = new Map<string, ToolHandler>(createHandlers(deps));

  if (judgeSubmit) {
    handlers.set(SUBMIT_JUDGEMENT_TOOL.name, {
      schema: SUBMIT_JUDGEMENT_TOOL,
      execute: async (input) => {
        judgeSubmit(input);
        return "判分已记录。";
      },
    });
  }

  return {
    schemas: [...handlers.values()].map((h) => h.schema),
    execute: async (name, input) => {
      const h = handlers.get(name);
      if (!h) {
        return JSON.stringify({ error: `未知工具: ${name}` });
      }
      try {
        return await h.execute(input);
      } catch (err) {
        // handler 异常兜底：返回错误 JSON 让模型可感知，而不是整轮失败
        return JSON.stringify({ error: `工具执行失败: ${(err as Error).message}` });
      }
    },
    has: (name) => handlers.has(name),
  };
}
