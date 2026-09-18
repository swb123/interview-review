import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  INTERVALS,
  nextInterval,
  addDays,
  startOfDay,
  applyResult,
  buildTodayQueue,
  computeStats,
  buildWrongBook,
  isMastered,
} from "./scheduler.js";
import type { Question } from "../data/questions.js";
import { formatISO } from "../memory/progress.js";
import type { ProgressEntry } from "../memory/progress.js";

const T = new Date(2026, 8, 18, 10, 30, 0); // 2026-09-18 10:30 本地时间（固定基准，避免跨天边界）

function entry(over: Partial<ProgressEntry> & { questionId: string }): ProgressEntry {
  return {
    consecutiveClear: 0,
    intervalDays: 0,
    nextReviewDate: "",
    clearCount: 0,
    unclearCount: 0,
    lastReviewed: null,
    ...over,
  };
}

function q(id: string, category = "十一、Agent 基础与架构"): Question {
  return { id, category, number: id.split("-").pop() ?? "Q1", question: `题面 ${id}`, answer: `答案 ${id}` };
}

function assertIsoFormat(s: string) {
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `日期格式应为无毫秒 ISO: ${s}`);
}

describe("nextInterval", () => {
  it("连续答对 1~6 次分别对应 1,2,4,7,15,30 天", () => {
    const expected = [1, 2, 4, 7, 15, 30];
    for (let i = 1; i <= 6; i++) {
      assert.equal(nextInterval(i), expected[i - 1]);
    }
  });
  it("第 7 次及以后封顶 30 天", () => {
    assert.equal(nextInterval(7), 30);
    assert.equal(nextInterval(100), 30);
  });
  it("边界：0 / 负数回落到 1 天", () => {
    assert.equal(nextInterval(0), 1);
    assert.equal(nextInterval(-3), 1);
  });
});

describe("applyResult", () => {
  it("新题 clear：consecutiveClear=1、间隔 1 天、日期无毫秒", () => {
    const e = applyResult("X-Q1", null, "clear", T);
    assert.equal(e.clearCount, 1);
    assert.equal(e.consecutiveClear, 1);
    assert.equal(e.intervalDays, 1);
    assert.equal(e.nextReviewDate, formatISO(addDays(T, 1)));
    assert.equal(e.lastReviewed, formatISO(T));
    assertIsoFormat(e.nextReviewDate);
    assertIsoFormat(e.lastReviewed!);
  });

  it("连续 clear 间隔递增链 1→2→4→7→15→30→30", () => {
    let e: ProgressEntry | null = null;
    const chain: number[] = [];
    for (let i = 0; i < 7; i++) {
      e = applyResult("X-Q1", e, "clear", T);
      chain.push(e.intervalDays);
    }
    assert.deepEqual(chain, [1, 2, 4, 7, 15, 30, 30]);
    assert.equal(e!.consecutiveClear, 7);
    assert.equal(e!.clearCount, 7);
  });

  it("unclear：consecutiveClear 清零、间隔回 1 天、clearCount 不变", () => {
    const before = entry({
      questionId: "X-Q1",
      consecutiveClear: 5,
      intervalDays: 15,
      clearCount: 6,
      unclearCount: 2,
      nextReviewDate: formatISO(addDays(T, 15)),
      lastReviewed: formatISO(addDays(T, -1)),
    });
    const e = applyResult("X-Q1", before, "unclear", T);
    assert.equal(e.consecutiveClear, 0);
    assert.equal(e.intervalDays, 1);
    assert.equal(e.nextReviewDate, formatISO(addDays(T, 1)));
    assert.equal(e.unclearCount, 3);
    assert.equal(e.clearCount, 6); // 不清零
  });

  it("unclear 新题：unclearCount=1、明天再来", () => {
    const e = applyResult("X-Q1", null, "unclear", T);
    assert.equal(e.unclearCount, 1);
    assert.equal(e.intervalDays, 1);
    assert.equal(e.nextReviewDate, formatISO(addDays(T, 1)));
  });

  it("mastered 边界：连续 4 次未掌握，第 5 次掌握", () => {
    let e: ProgressEntry | null = null;
    for (let i = 0; i < 4; i++) {
      e = applyResult("X-Q1", e, "clear", T);
      assert.equal(isMastered(e), false);
    }
    e = applyResult("X-Q1", e, "clear", T);
    assert.equal(isMastered(e), true);
  });
});

describe("buildTodayQueue", () => {
  const bank = {
    questions: [
      q("十一、Agent 基础与架构-Q1"),
      q("十一、Agent 基础与架构-Q2"),
      q("十二、工具调用与 Agent Loop-Q1"),
      q("十二、工具调用与 Agent Loop-Q2"),
      q("十二、工具调用与 Agent Loop-Q3"),
      q("十二、工具调用与 Agent Loop-Q4"),
      q("十二、工具调用与 Agent Loop-Q5"),
      q("十二、工具调用与 Agent Loop-Q6"),
      q("一、Java核心-Q1", "一、Java核心"),
      q("一、Java核心-Q2", "一、Java核心"),
    ],
  };

  it("新题配额 5、只从 agent 分类抽（默认 scope）", () => {
    const { newIntro, due } = buildTodayQueue(bank, new Map(), T);
    assert.equal(newIntro.length, 5);
    assert.ok(newIntro.every((x) => ["十一、", "十二、"].some((p) => x.category.startsWith(p))));
    assert.equal(due.length, 0);
  });

  it("scope: all 从全题库抽；scope: 数组按指定分类抽", () => {
    const all = buildTodayQueue(bank, new Map(), T, { scope: "all" });
    assert.equal(all.newIntro.length, 5);
    const byCat = buildTodayQueue(bank, new Map(), T, { scope: ["一、Java核心"] });
    assert.deepEqual(byCat.newIntro.map((x) => x.id).sort(), ["一、Java核心-Q1", "一、Java核心-Q2"]);
  });

  it("新题池不足配额时全量返回", () => {
    const bank3 = { questions: bank.questions.slice(0, 3) };
    const { newIntro } = buildTodayQueue(bank3, new Map(), T);
    assert.equal(newIntro.length, 3);
  });

  it("到期判定（startOfDay 边界）：昨天 23:59 到期、今天 00:00 到期、明天不到期", () => {
    const today = startOfDay(T);
    const y23 = new Date(today.getTime() - 60000); // 昨天 23:59
    const today0 = today;
    const tmr0 = addDays(today, 1);
    const m = new Map<string, ProgressEntry>([
      ["十一、Agent 基础与架构-Q1", entry({ questionId: "十一、Agent 基础与架构-Q1", nextReviewDate: formatISO(y23) })],
      ["十二、工具调用与 Agent Loop-Q1", entry({ questionId: "十二、工具调用与 Agent Loop-Q1", nextReviewDate: formatISO(today0) })],
      ["十二、工具调用与 Agent Loop-Q2", entry({ questionId: "十二、工具调用与 Agent Loop-Q2", nextReviewDate: formatISO(tmr0) })],
    ]);
    const { due } = buildTodayQueue(bank, m, T);
    const ids = due.map((x) => x.id);
    assert.ok(ids.includes("十一、Agent 基础与架构-Q1"));
    assert.ok(ids.includes("十二、工具调用与 Agent Loop-Q1"));
    assert.ok(!ids.includes("十二、工具调用与 Agent Loop-Q2"));
  });

  it("到期复习题不受 agent scope 限制（旧分类到期也出现）", () => {
    const m = new Map<string, ProgressEntry>([
      ["一、Java核心-Q1", entry({ questionId: "一、Java核心-Q1", nextReviewDate: formatISO(addDays(T, -1)) })],
    ]);
    const { due } = buildTodayQueue(bank, m, T);
    assert.deepEqual(due.map((x) => x.id), ["一、Java核心-Q1"]);
  });

  it("已学过的题不再出现在新题池", () => {
    const m = new Map<string, ProgressEntry>([
      ["十一、Agent 基础与架构-Q1", entry({ questionId: "x", nextReviewDate: formatISO(addDays(T, 10)) })],
    ]);
    const { newIntro } = buildTodayQueue(bank, m, T);
    assert.ok(!newIntro.some((x) => x.id === "十一、Agent 基础与架构-Q1"));
  });
});

describe("computeStats / buildWrongBook", () => {
  const bank = { questions: [q("a-Q1"), q("b-Q1"), q("c-Q1"), q("d-Q1")] };

  it("统计口径与 Swift 一致：reviewed/wrong/mastered", () => {
    const m = new Map<string, ProgressEntry>([
      ["a-Q1", entry({ questionId: "a-Q1", consecutiveClear: 5, unclearCount: 0 })],
      ["b-Q1", entry({ questionId: "b-Q1", consecutiveClear: 2, unclearCount: 3 })],
      ["c-Q1", entry({ questionId: "c-Q1", consecutiveClear: 0, unclearCount: 1 })],
    ]);
    assert.deepEqual(computeStats(m, 4), { total: 4, reviewed: 3, wrong: 2, mastered: 1 });
  });

  it("错题本按 unclearCount 降序、limit 生效、只含答错过的题", () => {
    const m = new Map<string, ProgressEntry>([
      ["a-Q1", entry({ questionId: "a-Q1", unclearCount: 1, clearCount: 0 })],
      ["b-Q1", entry({ questionId: "b-Q1", unclearCount: 5, clearCount: 2 })],
      ["c-Q1", entry({ questionId: "c-Q1", unclearCount: 0, clearCount: 3 })], // 没答错过，不出现
      ["d-Q1", entry({ questionId: "d-Q1", unclearCount: 3, clearCount: 1 })],
    ]);
    const all = buildWrongBook(bank, m);
    assert.deepEqual(all.map((x) => x.question.id), ["b-Q1", "d-Q1", "a-Q1"]);
    const limited = buildWrongBook(bank, m, 2);
    assert.equal(limited.length, 2);
  });
});

describe("addDays / startOfDay", () => {
  it("addDays 跨月正确（本地时间比较，不依赖时区）", () => {
    const d = addDays(new Date(2026, 6, 31, 12, 0, 0), 1); // 7 月 31 日 + 1 天
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 7); // 8 月
    assert.equal(d.getDate(), 1);
    assert.equal(d.getHours(), 12);
  });
  it("startOfDay 截断到本地 0 点", () => {
    const s = startOfDay(T);
    assert.equal(s.getHours(), 0);
    assert.equal(s.getMinutes(), 0);
    assert.equal(s.getSeconds(), 0);
    assert.equal(s.getMilliseconds(), 0);
  });
  it("INTERVALS 表与 Swift 一致", () => {
    assert.deepEqual([...INTERVALS], [1, 2, 4, 7, 15, 30]);
  });
});
