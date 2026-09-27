import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConversationContext, estimateTokens, KEEP_RECENT, MAX_EXCHANGES_BEFORE_COMPRESS, TOOL_RESULT_CLIP } from "./context.js";
import { assertProtocol } from "../testing/mock-llm.js";

function addExchange(ctx: ConversationContext, i: number, toolPayload = "x") {
  ctx.beginExchange(`问题 ${i}`);
  ctx.completeExchange([
    { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "get_stats", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: toolPayload }] },
    { role: "assistant", content: `回答 ${i}` },
  ]);
}

describe("estimateTokens", () => {
  it("中文按约 1 token/字估算，而不是长度/3.5", () => {
    const zh = "上下文工程是智能体开发的核心能力之一";
    assert.equal(estimateTokens(zh), zh.length);
  });
  it("英文约 4 字符/token", () => {
    assert.equal(estimateTokens("a".repeat(40)), 10);
  });
});

describe("ConversationContext", () => {
  it("保留工具调用轨迹，且消息协议合法", () => {
    const ctx = new ConversationContext(async () => "");
    addExchange(ctx, 1);
    addExchange(ctx, 2);
    ctx.beginExchange("第三问");
    const msgs = ctx.toMessages();
    assert.equal(assertProtocol(msgs), null);
    assert.ok(JSON.stringify(msgs).includes("tool_use"));
  });

  it("非最新 exchange 的大体积工具结果会被截断（上下文编辑）", () => {
    const ctx = new ConversationContext(async () => "");
    addExchange(ctx, 1, "长".repeat(2000));
    addExchange(ctx, 2, "新".repeat(2000));
    const msgs = ctx.toMessages();
    // 每个 exchange 4 条：user / assistant(tool_use) / user(tool_result) / assistant
    const first = JSON.stringify(msgs[2]);
    const latest = JSON.stringify(msgs[6]);
    assert.ok(first.length < TOOL_RESULT_CLIP + 200, "旧工具结果应被截断");
    assert.ok(latest.includes("新".repeat(2000)), "最新 exchange 保持原样");
  });

  it("超过轮数阈值时压缩：窗口缩回 KEEP_RECENT，摘要合并", async () => {
    let seen = "";
    const ctx = new ConversationContext(async (history, prev) => {
      seen = history;
      return `${prev}|摘要`;
    });
    for (let i = 1; i <= MAX_EXCHANGES_BEFORE_COMPRESS + 1; i++) addExchange(ctx, i);
    assert.equal(ctx.needsCompression(), true);
    await ctx.compress();
    assert.equal(ctx.summaryText, "|摘要");
    assert.match(seen, /问题 1/);
    assert.ok(!seen.includes(`问题 ${MAX_EXCHANGES_BEFORE_COMPRESS + 1}`));
    const msgs = ctx.toMessages();
    assert.equal(msgs.filter((m) => typeof m.content === "string" && m.content.startsWith("问题")).length, KEEP_RECENT);
    assert.equal(assertProtocol(msgs), null);
  });

  it("真实 usage 超预算也触发压缩", () => {
    const ctx = new ConversationContext(async () => "");
    for (let i = 1; i <= KEEP_RECENT + 1; i++) addExchange(ctx, i);
    assert.equal(ctx.needsCompression(), false);
    ctx.recordUsage(50_000);
    assert.equal(ctx.needsCompression(), true);
  });
});
