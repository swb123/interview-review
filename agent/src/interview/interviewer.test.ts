import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInterview } from "./interviewer.js";
import { JUDGE_SYSTEM_PROMPT } from "../judge/schema.js";
import type { QuestionBank } from "../data/questions.js";
import { mockChat, msg, text, toolUse } from "../testing/mock-llm.js";

process.env.TRACE = "off";

const bank: QuestionBank = {
  version: "t",
  total: 2,
  questions: [
    { id: "十一、A-Q1", category: "十一、A", number: "Q1", question: "题一", answer: "答案一：秘密要点" },
    { id: "十一、A-Q2", category: "十一、A", number: "Q2", question: "题二", answer: "答案二" },
  ],
};

const judgement = {
  verdict: "unclear",
  score: 40,
  covered_points: ["a"],
  missed_points: ["b"],
  explanation: "答案一：秘密要点",
  suggestion: "s",
};

const report = {
  overall_score: 60,
  strengths: ["x"],
  weaknesses: ["y"],
  next_steps: ["z"],
  per_question: [{ questionId: "十一、A-Q1", verdict: "clear", note: "追问答上了" }],
};

/** 面试官与判分员共用同一个 mock：按 system prompt 区分是谁在调用 */
function scripted(interviewer: ReturnType<typeof msg>[]) {
  let k = 0;
  const judgeSteps = [
    msg([toolUse("get_question", { questionId: "十一、A-Q1" })]),
    msg([toolUse("submit_judgement", judgement)]),
    msg([text("ok")]),
  ];
  let j = 0;
  const mock = mockChat([]);
  const chat: typeof mock.chat = async (opts) => {
    mock.calls.push(structuredClone(opts.messages));
    mock.systems.push(opts.system);
    if (opts.system === JUDGE_SYSTEM_PROMPT) return { message: judgeSteps[j++ % judgeSteps.length], elapsedMs: 1 };
    return { message: interviewer[Math.min(k++, interviewer.length - 1)], elapsedMs: 1 };
  };
  return { chat, mock };
}

describe("runInterview", () => {
  it("完整流程：提问 → 判分 → 追问 → 记录 → 报告；面试官看不到标准答案原文", async () => {
    const dir = mkdtempSync(join(tmpdir(), "interview-"));
    const progressPath = join(dir, "progress.json");
    const { chat, mock } = scripted([
      msg([toolUse("ask_candidate", { kind: "main", questionId: "十一、A-Q1", text: "说说题一" })]),
      msg([toolUse("judge_answer", { questionId: "十一、A-Q1", answer: "我的回答" })]),
      msg([toolUse("ask_candidate", { kind: "followup", text: "那 b 呢？" })]),
      msg([toolUse("record_result", { questionId: "十一、A-Q1", result: "clear" })]),
      msg([toolUse("finish_interview", report)]),
      msg([text("今天就到这里。")]),
    ]);
    const asked: string[] = [];
    const out = await runInterview({
      bank,
      progressPath,
      chat,
      ask: async (t, meta) => {
        asked.push(`${meta.kind}:${t}`);
        return "候选人回答";
      },
    });
    assert.deepEqual(asked, ["main:说说题一", "followup:那 b 呢？"]);
    assert.equal(out.report?.overall_score, 60);
    assert.equal(out.closing, "今天就到这里。");
    assert.deepEqual(out.recorded, [{ questionId: "十一、A-Q1", result: "clear" }]);
    assert.ok(existsSync(progressPath));
    assert.match(readFileSync(progressPath, "utf8"), /十一、A-Q1/);
    // 面试官侧的全部请求里都不应出现标准答案/讲解原文
    const interviewerCalls = mock.calls.filter((_, i) => mock.systems[i] !== JUDGE_SYSTEM_PROMPT);
    assert.ok(!JSON.stringify(interviewerCalls).includes("秘密要点"));
  });

  it("护栏：追问超上限、判未问过的题 → is_error 回填，由模型自行纠正", async () => {
    const { chat, mock } = scripted([
      msg([toolUse("judge_answer", { questionId: "十一、A-Q2", answer: "x" })]),
      msg([toolUse("ask_candidate", { kind: "main", questionId: "十一、A-Q1", text: "q" })]),
      msg([toolUse("ask_candidate", { kind: "followup", text: "f1" })]),
      msg([toolUse("ask_candidate", { kind: "followup", text: "f2" })]),
      msg([toolUse("finish_interview", report)]),
      msg([text("结束")]),
    ]);
    const asked: string[] = [];
    const out = await runInterview({
      bank,
      chat,
      dryRun: true,
      maxFollowups: 1,
      ask: async (t) => {
        asked.push(t);
        return "a";
      },
    });
    assert.deepEqual(asked, ["q", "f1"], "第二次追问被护栏拦截");
    const errors = out.loop.stats.toolCalls.filter((c) => !c.ok).map((c) => c.name);
    assert.deepEqual(errors, ["judge_answer", "ask_candidate"]);
    assert.ok(mock.calls.length > 0);
  });

  it("候选人输入 exit → 通知面试官收尾；dryRun 不落盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "interview-"));
    const progressPath = join(dir, "progress.json");
    const { chat } = scripted([
      msg([toolUse("ask_candidate", { kind: "main", questionId: "十一、A-Q1", text: "q" })]),
      msg([toolUse("record_result", { questionId: "十一、A-Q1", result: "unclear" })]),
      msg([toolUse("finish_interview", report)]),
      msg([text("好的，再见")]),
    ]);
    const out = await runInterview({ bank, chat, progressPath, dryRun: true, ask: async () => "exit" });
    // exit 之后除 finish_interview 外的工具都被拒绝
    assert.deepEqual(out.recorded, []);
    assert.equal(out.report?.overall_score, 60);
    assert.ok(!existsSync(progressPath));
  });
});
