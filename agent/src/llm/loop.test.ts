import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgentLoop, TRUNCATED_TOOL_ERROR } from "./loop.js";
import { assertProtocol, mockChat, msg, text, toolUse } from "../testing/mock-llm.js";

function toolResults(m: Anthropic.MessageParam): Anthropic.ToolResultBlockParam[] {
  return typeof m.content === "string"
    ? []
    : (m.content.filter((b) => b.type === "tool_result") as Anthropic.ToolResultBlockParam[]);
}

describe("runAgentLoop", () => {
  it("无工具调用直接结束", async () => {
    const mock = mockChat([msg([text("你好")])]);
    const r = await runAgentLoop({
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      executeTool: async () => "",
      chat: mock.chat,
    });
    assert.equal(r.kind, "end");
    assert.equal(r.stats.iterations, 1);
    assert.equal(r.stats.totalInputTokens, 100);
    assert.equal(r.stats.lastInputTokens, 100);
  });

  it("并行工具调用：结果合并在同一条 user 消息里，且按 tool_use_id 对齐", async () => {
    const mock = mockChat([
      msg([toolUse("a", { x: 1 }, "t1"), toolUse("b", {}, "t2")]),
      msg([text("完成")]),
    ]);
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "go" }];
    const r = await runAgentLoop({
      system: "s",
      tools: [],
      messages,
      executeTool: async (name) => `result-${name}`,
      chat: mock.chat,
    });
    assert.equal(r.kind, "end");
    assert.equal(assertProtocol(mock.calls[1]), null);
    const results = toolResults(mock.calls[1][2]);
    assert.deepEqual(results.map((x) => [x.tool_use_id, x.content]), [["t1", "result-a"], ["t2", "result-b"]]);
    assert.equal(r.stats.toolCalls.length, 2);
  });

  it("工具抛错 → is_error 回填，不中断循环", async () => {
    const mock = mockChat([msg([toolUse("boom", {}, "t1")]), msg([text("已降级")])]);
    const r = await runAgentLoop({
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "go" }],
      executeTool: async () => {
        throw new Error("磁盘满了");
      },
      chat: mock.chat,
    });
    assert.equal(r.kind, "end");
    const [res] = toolResults(mock.calls[1][2]);
    assert.equal(res.is_error, true);
    assert.match(String(res.content), /磁盘满了/);
    assert.deepEqual(r.stats.toolCalls.map((c) => c.ok), [false]);
  });

  it("护栏：一直调工具 → max_iterations，且不超过上限", async () => {
    const mock = mockChat([msg([toolUse("loop", {})])]);
    let executed = 0;
    const r = await runAgentLoop({
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "go" }],
      executeTool: async () => {
        executed++;
        return "again";
      },
      maxIterations: 3,
      chat: mock.chat,
    });
    assert.equal(r.kind, "max_iterations");
    assert.equal(mock.calls.length, 3);
    assert.equal(executed, 3);
  });

  it("纯文本被 max_tokens 截断 → 回填已输出部分 + 续写，协议交替合法", async () => {
    const mock = mockChat([
      msg([text("前半段")], "max_tokens"),
      msg([text("后半段")]),
    ]);
    const r = await runAgentLoop({
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "go" }],
      executeTool: async () => "",
      chat: mock.chat,
    });
    assert.equal(r.kind, "end");
    assert.equal(r.stats.truncations, 1);
    const second = mock.calls[1];
    assert.equal(assertProtocol(second), null);
    assert.equal(second[1].role, "assistant");
    assert.equal(second[2].role, "user");
  });

  it("带工具调用被截断 → 最后一个 tool_use 不执行、is_error 回填，且没有连续两条 user", async () => {
    const mock = mockChat([
      msg([toolUse("ok_tool", {}, "t1"), toolUse("half_tool", {}, "t2")], "max_tokens"),
      msg([text("重试完成")]),
    ]);
    const executed: string[] = [];
    const r = await runAgentLoop({
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "go" }],
      executeTool: async (name) => {
        executed.push(name);
        return "done";
      },
      chat: mock.chat,
    });
    assert.equal(r.kind, "end");
    assert.deepEqual(executed, ["ok_tool"]);
    const second = mock.calls[1];
    assert.equal(assertProtocol(second), null);
    assert.equal(second.length, 3, "assistant 之后只有一条 user（tool_result 合并）");
    const res = toolResults(second[2]);
    assert.equal(res[1].tool_use_id, "t2");
    assert.equal(res[1].is_error, true);
    assert.equal(res[1].content, TRUNCATED_TOOL_ERROR);
  });

  it("回填时剥离 thinking 块", async () => {
    const thinking = msg([toolUse("a", {}, "t1")]);
    (thinking.content as unknown[]).unshift({ type: "thinking", thinking: "内心戏", signature: "x" });
    const mock = mockChat([thinking, msg([text("ok")])]);
    await runAgentLoop({
      system: "s",
      tools: [],
      messages: [{ role: "user", content: "go" }],
      executeTool: async () => "r",
      chat: mock.chat,
    });
    const assistant = mock.calls[1][1];
    assert.ok(Array.isArray(assistant.content));
    assert.ok(!(assistant.content as { type: string }[]).some((b) => b.type === "thinking"));
  });
});
