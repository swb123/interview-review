import type Anthropic from "@anthropic-ai/sdk";
import type { QuestionBank } from "../data/questions.js";
import { loadProgress, updateProgress } from "../memory/progress.js";
import {
  applyResult,
  buildTodayQueue,
  buildWrongBook,
  computeStats,
} from "../scheduler/scheduler.js";

/**
 * 工具实现层。
 * 安全边界（面试讲点）：get_question 在公共通道（revealAnswer=false）永不返回标准答案，
 * 答案只经 judge 内部通道（revealAnswer=true）流出；record_result 是唯一写工具，
 * 写的是 scheduler 纯函数的计算结果，而非 LLM 的自由文本。
 */

export interface HandlerDeps {
  bank: QuestionBank;
  /** progress.json 路径（默认 ~/interview-review/progress.json） */
  progressPath?: string;
  /** 是否暴露标准答案（仅 judge 内部通道为 true） */
  revealAnswer: boolean;
  /** 时间注入（测试用） */
  now?: () => Date;
}

export interface ToolHandler {
  schema: Anthropic.Tool;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

// ---------------------------------------------------------------------------
// 工具 schema（手写 input_schema，不依赖 betaZodTool）
// ---------------------------------------------------------------------------

export const LOAD_TODAY_QUEUE_TOOL: Anthropic.Tool = {
  name: "load_today_queue",
  description:
    "获取今日复习队列：每日新题（默认 5 道，从 agent 专题分类抽取）+ 到期复习题（间隔重复调度）。返回每题的 index/id/分类/题面/类型。",
  input_schema: { type: "object", properties: {} },
};

export const GET_QUESTION_TOOL: Anthropic.Tool = {
  name: "get_question",
  description:
    "按题目 ID 获取题目详情。questionId 形如「十一、Agent 基础与架构-Q1」。（注意：此工具不返回标准答案，判分由内部通道完成）",
  input_schema: {
    type: "object",
    properties: {
      questionId: { type: "string", description: "题目 ID" },
    },
    required: ["questionId"],
  },
};

export const GET_STATS_TOOL: Anthropic.Tool = {
  name: "get_stats",
  description: "获取学习统计：题库总数/已学/错题/掌握，以及今日队列的新题与到期题数量。",
  input_schema: { type: "object", properties: {} },
};

export const GET_WRONG_BOOK_TOOL: Anthropic.Tool = {
  name: "get_wrong_book",
  description: "获取错题本：答错过的题按答错次数降序，可选 limit 限制条数。",
  input_schema: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "最多返回条数（默认 20）" },
    },
  },
};

export const RECORD_RESULT_TOOL: Anthropic.Tool = {
  name: "record_result",
  description:
    "记录一道题的作答结果并更新间隔重复进度。result 为 clear（掌握，间隔递增 1→2→4→7→15→30 天）或 unclear（未掌握，明天再来）。",
  input_schema: {
    type: "object",
    properties: {
      questionId: { type: "string", description: "题目 ID" },
      result: {
        type: "string",
        enum: ["clear", "unclear"],
        description: "作答结果",
      },
    },
    required: ["questionId", "result"],
  },
};

// ---------------------------------------------------------------------------
// handler 实现
// ---------------------------------------------------------------------------

export function createHandlers(deps: HandlerDeps): Map<string, ToolHandler> {
  const now = deps.now ?? (() => new Date());
  const handlers = new Map<string, ToolHandler>();

  handlers.set(LOAD_TODAY_QUEUE_TOOL.name, {
    schema: LOAD_TODAY_QUEUE_TOOL,
    execute: async () => {
      const progress = loadProgress(deps.progressPath);
      const { newIntro, due } = buildTodayQueue(deps.bank, progress, now());
      const queue = [
        ...newIntro.map((q, i) => ({
          index: i + 1,
          id: q.id,
          category: q.category,
          question: q.question,
          kind: "新题",
        })),
        ...due.map((q, i) => ({
          index: newIntro.length + i + 1,
          id: q.id,
          category: q.category,
          question: q.question,
          kind: "复习",
        })),
      ];
      return JSON.stringify({
        newCount: newIntro.length,
        dueCount: due.length,
        total: queue.length,
        queue,
      });
    },
  });

  handlers.set(GET_QUESTION_TOOL.name, {
    schema: GET_QUESTION_TOOL,
    execute: async (input) => {
      const id = String(input.questionId ?? "");
      const q = deps.bank.questions.find((x) => x.id === id);
      if (!q) return JSON.stringify({ error: `题目不存在: ${id}` });
      return JSON.stringify({
        id: q.id,
        category: q.category,
        question: q.question,
        ...(deps.revealAnswer ? { answer: q.answer } : {}),
      });
    },
  });

  handlers.set(GET_STATS_TOOL.name, {
    schema: GET_STATS_TOOL,
    execute: async () => {
      const progress = loadProgress(deps.progressPath);
      const stats = computeStats(progress, deps.bank.questions.length);
      const queue = buildTodayQueue(deps.bank, progress, now());
      return JSON.stringify({
        ...stats,
        todayNew: queue.newIntro.length,
        todayDue: queue.due.length,
      });
    },
  });

  handlers.set(GET_WRONG_BOOK_TOOL.name, {
    schema: GET_WRONG_BOOK_TOOL,
    execute: async (input) => {
      const limit = Number.isInteger(input.limit) ? (input.limit as number) : 20;
      const progress = loadProgress(deps.progressPath);
      const entries = buildWrongBook(deps.bank, progress, limit);
      return JSON.stringify(
        entries.map((e) => ({
          id: e.question.id,
          category: e.question.category,
          question: e.question.question,
          unclearCount: e.unclearCount,
          clearCount: e.clearCount,
          lastReviewed: e.lastReviewed,
        })),
      );
    },
  });

  handlers.set(RECORD_RESULT_TOOL.name, {
    schema: RECORD_RESULT_TOOL,
    execute: async (input) => {
      const id = String(input.questionId ?? "");
      const result = String(input.result ?? "");
      if (result !== "clear" && result !== "unclear") {
        return JSON.stringify({ error: `非法 result: ${result}（应为 clear 或 unclear）` });
      }
      if (!deps.bank.questions.some((q) => q.id === id)) {
        return JSON.stringify({ error: `题目不存在: ${id}` });
      }
      const entry = updateProgress(
        id,
        (e) => applyResult(id, e, result as "clear" | "unclear", now()),
        deps.progressPath,
      );
      return JSON.stringify(entry);
    },
  });

  return handlers;
}
