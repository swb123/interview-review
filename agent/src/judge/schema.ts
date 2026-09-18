import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * 判分结果 schema（zod 校验 + 手写 JSON Schema 注入 submit_judgement 工具）。
 * 双份定义是刻意的：judge 工具的 input_schema 是手写的（与 zod 校验独立），
 * 避免引入 zod-to-json-schema 依赖；两者字段一一对应，改一处必须同步另一处。
 */

export const JudgementSchema = z.object({
  /** 是否掌握：clear 间隔递增，unclear 明天再来 */
  verdict: z.enum(["clear", "unclear"]),
  /** 掌握度 0-100 */
  score: z.number().min(0).max(100),
  /** 用户答到的要点 */
  covered_points: z.array(z.string()),
  /** 遗漏的要点 */
  missed_points: z.array(z.string()),
  /** 讲解（中文，含标准答案关键内容，重点讲遗漏部分） */
  explanation: z.string(),
  /** 一句话下一步建议 */
  suggestion: z.string(),
});

export type Judgement = z.infer<typeof JudgementSchema>;

export const SUBMIT_JUDGEMENT_TOOL: Anthropic.Tool = {
  name: "submit_judgement",
  description:
    "提交对用户回答的判分结果。必须先调用 get_question 获取标准答案、对照评估后再调用本工具。必须调用，不要用纯文本代替。",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["clear", "unclear"],
        description:
          "是否掌握：clear=覆盖主要要点且无关键错误；unclear=遗漏关键点或有明显错误",
      },
      score: { type: "number", description: "掌握度评分 0-100" },
      covered_points: {
        type: "array",
        items: { type: "string" },
        description: "用户回答中答到的要点",
      },
      missed_points: {
        type: "array",
        items: { type: "string" },
        description: "用户回答中遗漏或答错的要点",
      },
      explanation: {
        type: "string",
        description: "中文讲解：标准答案关键内容，重点展开用户遗漏的部分",
      },
      suggestion: { type: "string", description: "一句话的下一步学习建议" },
    },
    required: [
      "verdict",
      "score",
      "covered_points",
      "missed_points",
      "explanation",
      "suggestion",
    ],
  },
};

/** 判分子流程的 system prompt（每题独立会话，不带主会话历史） */
export const JUDGE_SYSTEM_PROMPT = `你是一位严格的面试官判分员。你的任务是对照标准答案评估考生的回答。

流程（必须按顺序）：
1. 调用 get_question 工具获取该题的标准答案
2. 对照标准答案评估用户回答：答到了哪些要点（covered_points）、遗漏或答错了哪些（missed_points）
3. 调用 submit_judgement 工具提交判分结果——必须调用工具提交，不要用纯文本输出 JSON

判分标准：
- verdict=clear（掌握）：覆盖了标准答案的主要要点，且无关键性错误
- verdict=unclear（未掌握）：遗漏关键要点，或存在明显错误（哪怕答对了一部分）
- score：0-100 的掌握度，unclear 时建议 60 分以下，clear 时 60 分以上
- covered_points / missed_points：短要点（每条 20 字以内），直接对应标准答案的要点
- explanation：用中文讲解本题标准答案的关键内容，重点展开用户遗漏的部分，300 字以内
- suggestion：一句话，指出下一步最该补的知识点

评分要严格：面试场景下"大概知道"不等于掌握。`;
