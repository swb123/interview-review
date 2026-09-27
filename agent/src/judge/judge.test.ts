import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { judge } from "./judge.js";
import type { QuestionBank } from "../data/questions.js";
import { mockChat, msg, text, toolUse } from "../testing/mock-llm.js";

const bank: QuestionBank = {
  version: "t",
  total: 1,
  questions: [{ id: "Q-1", category: "十一、测试", number: "Q1", question: "什么是 agent？", answer: "标准答案：循环 + 工具 + 自主决策" }],
};

const good = {
  verdict: "clear",
  score: 85,
  covered_points: ["循环"],
  missed_points: [],
  explanation: "讲解",
  suggestion: "建议",
};

describe("judge 三级兜底", () => {
  it("通道①：get_question → submit_judgement 工具", async () => {
    const mock = mockChat([
      msg([toolUse("get_question", { questionId: "Q-1" })]),
      msg([toolUse("submit_judgement", good)]),
      msg([text("判完了")]),
    ]);
    const r = await judge({ bank, chat: mock.chat }, { questionId: "Q-1", userAnswer: "循环调用工具" });
    assert.equal(r.via, "tool");
    assert.ok(r.via === "tool" && r.judgement.score === 85);
    assert.ok(r.stats && r.stats.iterations === 3);
    // judge 内部通道能拿到标准答案
    const toolResult = JSON.stringify(mock.calls[1][2]);
    assert.match(toolResult, /标准答案/);
  });

  it("通道②：模型不调工具、输出 ```json 围栏 → zod 校验通过", async () => {
    const mock = mockChat([msg([text("结果如下\n```json\n" + JSON.stringify(good) + "\n```")])]);
    const r = await judge({ bank, chat: mock.chat }, { questionId: "Q-1", userAnswer: "x" });
    assert.equal(r.via, "text");
  });

  it("submit_judgement 字段不合法 + 无围栏 → fallback", async () => {
    const mock = mockChat([
      msg([toolUse("submit_judgement", { ...good, score: 150 })]),
      msg([text("好的")]),
    ]);
    const r = await judge({ bank, chat: mock.chat }, { questionId: "Q-1", userAnswer: "x" });
    assert.equal(r.via, "fallback");
  });

  it("题目不存在 → 直接 fallback，不调用 LLM", async () => {
    const mock = mockChat([msg([text("不该被调用")])]);
    const r = await judge({ bank, chat: mock.chat }, { questionId: "nope", userAnswer: "x" });
    assert.equal(r.via, "fallback");
    assert.equal(mock.calls.length, 0);
  });
});
