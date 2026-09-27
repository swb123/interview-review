import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { QuestionBank } from "../data/questions.js";
import { config } from "../config.js";
import { judge } from "../judge/judge.js";
import type { Judgement } from "../judge/schema.js";
import { runAgentLoop } from "../llm/loop.js";
import type { ChatFn, LoopResult } from "../llm/loop.js";
import { createHandlers } from "../tools/handlers.js";
import { writeTrace } from "../observability/trace.js";

/**
 * 模拟面试官模式：真正由模型掌握控制流的 agent。
 *
 * 与「今日复习」（代码编排、LLM 只判分）的区别：出哪道题、要不要追问、
 * 追问什么、何时换题、何时结束，全部由面试官 agent 在 loop 里自主决定。
 *
 * 设计要点（面试讲点）：
 * - Human-in-the-loop 工具：ask_candidate 阻塞等待真人作答，结果作为 tool_result 回填
 * - 子 agent 即工具：judge_answer 内部跑独立的判分 loop（上下文隔离），
 *   只把 verdict/score/要点 返回给面试官
 * - 信息隔离：面试官拿不到标准答案原文（只看到判分要点），追问时无从泄题
 * - 护栏写在代码里而非 prompt 里：主问题数上限、单题追问上限、
 *   只能判/记已经问过的题、loop 最大轮次；越界返回 is_error 让模型自行纠正
 * - 结构化收尾：finish_interview 提交 zod 校验的面试报告
 */

export const InterviewReportSchema = z.object({
  overall_score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  next_steps: z.array(z.string()),
  per_question: z.array(
    z.object({
      questionId: z.string(),
      verdict: z.enum(["clear", "unclear"]),
      note: z.string(),
    }),
  ),
});
export type InterviewReport = z.infer<typeof InterviewReportSchema>;

export const INTERVIEWER_SYSTEM = `你是一位资深 AI Agent 工程师岗位的技术面试官，正在对候选人进行模拟面试。

你的工具：
- load_today_queue / get_wrong_book：了解候选人今天该复习的题、历史薄弱点，据此选题
- ask_candidate：向候选人提问并等待回答。kind=main 为新的主问题（必须带 questionId）；kind=followup 为针对当前主问题的追问
- judge_answer：把候选人对某道主问题的回答交给判分员，得到 verdict/score/覆盖点/遗漏点
- record_result：记录一道题的最终掌握情况（综合主问题与追问表现）
- finish_interview：结束面试并提交结构化报告

面试方法：
1. 开场先看 get_wrong_book 与 load_today_queue，优先考察薄弱点，兼顾新题
2. 每道主问题：ask_candidate(main) → judge_answer → 根据遗漏点决定是否追问
3. 追问要具体：针对遗漏点或回答中模糊的地方深挖一层，像真实面试官那样问「为什么」「如果……怎么办」；不要把标准答案说出来
4. 追问答好了可以把该题记为 clear，答不上来记 unclear；每道主问题结束都要 record_result
5. 题数用完、或候选人要求结束时，调用 finish_interview 提交报告，然后用一两句话收尾
6. 全程中文；每次提问只问一个问题，不要一次抛出多个问题`;

const ASK_CANDIDATE_TOOL: Anthropic.Tool = {
  name: "ask_candidate",
  description:
    "向候选人提一个问题并等待其回答，返回候选人的原话。kind=main 开启新主问题（必须提供 questionId，text 可复述或改写题面）；kind=followup 追问当前主问题。",
  input_schema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["main", "followup"] },
      questionId: { type: "string", description: "题目 ID（kind=main 时必填）" },
      text: { type: "string", description: "对候选人说的话（问题本身）" },
    },
    required: ["kind", "text"],
  },
};

const JUDGE_ANSWER_TOOL: Anthropic.Tool = {
  name: "judge_answer",
  description:
    "把候选人对某道主问题的回答交给判分员评估（判分员能看到标准答案，你看不到）。返回 verdict/score/covered_points/missed_points/suggestion。只能判已经问过的主问题。",
  input_schema: {
    type: "object",
    properties: {
      questionId: { type: "string" },
      answer: { type: "string", description: "候选人的回答原文" },
    },
    required: ["questionId", "answer"],
  },
};

const FINISH_TOOL: Anthropic.Tool = {
  name: "finish_interview",
  description: "结束面试并提交结构化报告。调用后面试即结束。",
  input_schema: {
    type: "object",
    properties: {
      overall_score: { type: "number", description: "整体表现 0-100" },
      strengths: { type: "array", items: { type: "string" } },
      weaknesses: { type: "array", items: { type: "string" } },
      next_steps: { type: "array", items: { type: "string" }, description: "下一步复习建议" },
      per_question: {
        type: "array",
        items: {
          type: "object",
          properties: {
            questionId: { type: "string" },
            verdict: { type: "string", enum: ["clear", "unclear"] },
            note: { type: "string", description: "一句话点评" },
          },
          required: ["questionId", "verdict", "note"],
        },
      },
    },
    required: ["overall_score", "strengths", "weaknesses", "next_steps", "per_question"],
  },
};

export interface InterviewDeps {
  bank: QuestionBank;
  progressPath?: string;
  /** 向真人提问（CLI 注入 readline；测试注入脚本化回答）。返回 "exit" 表示候选人要结束 */
  ask: (text: string, meta: { kind: "main" | "followup"; questionId?: string }) => Promise<string>;
  /** 为 true 时 record_result 不落盘 */
  dryRun?: boolean;
  maxQuestions?: number;
  maxFollowups?: number;
  chat?: ChatFn;
  /** 面试官/判分工具调用回显 */
  onEvent?: (e: { type: "tool"; name: string; ok: boolean; ms: number } | { type: "judged"; questionId: string; judgement: Judgement }) => void;
}

export interface InterviewOutcome {
  report: InterviewReport | null;
  closing: string;
  asked: string[];
  recorded: { questionId: string; result: "clear" | "unclear" }[];
  loop: LoopResult;
}

export async function runInterview(deps: InterviewDeps): Promise<InterviewOutcome> {
  const maxQuestions = deps.maxQuestions ?? 3;
  const maxFollowups = deps.maxFollowups ?? 2;

  const base = createHandlers({ bank: deps.bank, progressPath: deps.progressPath, revealAnswer: false });
  const asked: string[] = [];
  const followups = new Map<string, number>();
  const recorded: InterviewOutcome["recorded"] = [];
  let current: string | null = null;
  let ended = false;
  let report: InterviewReport | null = null;

  const err = (msg: string) => {
    throw new Error(msg);
  };

  const execute = async (name: string, input: Record<string, unknown>): Promise<string> => {
    if (ended && name !== "finish_interview") {
      err("面试已结束（候选人要求退出或已提交报告），请直接调用 finish_interview 或输出结束语。");
    }
    switch (name) {
      case "load_today_queue":
      case "get_wrong_book":
      case "get_stats":
        return base.get(name)!.execute(input);

      case "ask_candidate": {
        const kind = input.kind === "followup" ? "followup" : "main";
        const text = String(input.text ?? "").trim();
        if (!text) err("text 不能为空");
        if (kind === "main") {
          const id = String(input.questionId ?? "");
          if (!deps.bank.questions.some((q) => q.id === id)) err(`题目不存在: ${id}`);
          if (asked.includes(id)) err(`该题已经问过: ${id}，请换一道`);
          if (asked.length >= maxQuestions) {
            err(`已达主问题上限 ${maxQuestions} 道，请调用 finish_interview 结束面试`);
          }
          asked.push(id);
          current = id;
          followups.set(id, 0);
        } else {
          if (!current) err("还没有主问题，不能追问；请先用 kind=main 提问");
          const n = followups.get(current!) ?? 0;
          if (n >= maxFollowups) {
            err(`当前题追问已达上限 ${maxFollowups} 次，请 record_result 后换题或结束`);
          }
          followups.set(current!, n + 1);
        }
        const answer = (await deps.ask(text, { kind, questionId: current ?? undefined })).trim();
        if (answer === "exit") {
          ended = true;
          return JSON.stringify({ candidate_left: true, note: "候选人要求结束面试，请调用 finish_interview 提交报告" });
        }
        return JSON.stringify({ answer: answer || "（候选人没有作答）" });
      }

      case "judge_answer": {
        const id = String(input.questionId ?? "");
        if (!asked.includes(id)) err(`只能判已经问过的主问题: ${id}`);
        const r = await judge(
          { bank: deps.bank, progressPath: deps.progressPath, chat: deps.chat },
          { questionId: id, userAnswer: String(input.answer ?? "") },
        );
        writeTrace({ mode: "judge", questionId: id, via: r.via }, r.stats);
        if (r.via === "fallback") {
          throw new Error("判分员暂不可用，请你根据回答自行评估");
        }
        const j = r.judgement;
        deps.onEvent?.({ type: "judged", questionId: id, judgement: j });
        // 只回传要点，不回传 explanation（含标准答案内容）——面试官追问时无从泄题
        return JSON.stringify({
          verdict: j.verdict,
          score: j.score,
          covered_points: j.covered_points,
          missed_points: j.missed_points,
          suggestion: j.suggestion,
        });
      }

      case "record_result": {
        const id = String(input.questionId ?? "");
        const result = input.result;
        if (!asked.includes(id)) err(`只能记录已经问过的题: ${id}`);
        if (result !== "clear" && result !== "unclear") err(`非法 result: ${String(result)}`);
        const prev = recorded.findIndex((r) => r.questionId === id);
        if (prev >= 0) recorded.splice(prev, 1);
        recorded.push({ questionId: id, result: result as "clear" | "unclear" });
        if (deps.dryRun) return JSON.stringify({ recorded: true, dryRun: true });
        return base.get("record_result")!.execute(input);
      }

      case "finish_interview": {
        const parsed = InterviewReportSchema.safeParse(input);
        if (!parsed.success) {
          err(`报告格式不合法: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
        }
        report = parsed.data!;
        ended = true;
        return "报告已提交。请用一两句话向候选人收尾，不要再调用工具。";
      }

      default:
        err(`未知工具: ${name}`);
    }
    return "";
  };

  const tools = [
    base.get("load_today_queue")!.schema,
    base.get("get_wrong_book")!.schema,
    ASK_CANDIDATE_TOOL,
    JUDGE_ANSWER_TOOL,
    base.get("record_result")!.schema,
    FINISH_TOOL,
  ];

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `请开始模拟面试。本场最多 ${maxQuestions} 道主问题，每道题最多追问 ${maxFollowups} 次。`,
    },
  ];

  const loop = await runAgentLoop({
    system: INTERVIEWER_SYSTEM,
    tools,
    messages,
    executeTool: execute,
    // 每道题约 ask + judge + 追问×2 + record ≈ 5~6 轮，外加开场与收尾
    maxIterations: maxQuestions * (maxFollowups + 4) + 4,
    maxTokens: config.chatMaxTokens,
    chat: deps.chat,
    onToolUse: (name, _input, ok, ms) => deps.onEvent?.({ type: "tool", name, ok, ms }),
  });
  writeTrace({ mode: "interview", kind: loop.kind }, loop.stats);

  const closing = loop.message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { report, closing, asked, recorded, loop };
}
