import type { Question } from "../data/questions.js";
import { formatISO } from "../memory/progress.js";
import type { ProgressEntry, ProgressMap } from "../memory/progress.js";

// 调度核心：逐字段移植 Swift Models.swift ReviewSession（唯一权威源）。
// 纯函数、时间作参数注入、无 IO、无 LLM —— 可单测、可复用。

/** 间隔表：连续答对 N 次后的下次间隔（与 Swift nextInterval 一致） */
export const INTERVALS = [1, 2, 4, 7, 15, 30] as const;
/** 每日新题配额（与 Swift dailyNewQuota 一致） */
export const DAILY_NEW_QUOTA = 5;
/** agent 专题分类前缀（默认出题范围：agent 岗面试冲刺） */
export const AGENT_CATEGORY_PREFIXES = ["十一、", "十二、", "十三、", "十四、", "十五、", "十六、"];

export function nextInterval(consecutiveClear: number): number {
  const idx = Math.max(0, consecutiveClear - 1);
  return INTERVALS[Math.min(idx, INTERVALS.length - 1)];
}

export function addDays(now: Date, days: number): Date {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** 本地时区当日 0 点（对齐 Swift Calendar.current.startOfDay） */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function baseEntry(questionId: string): ProgressEntry {
  return {
    questionId,
    consecutiveClear: 0,
    intervalDays: 0,
    nextReviewDate: "",
    clearCount: 0,
    unclearCount: 0,
    lastReviewed: null,
  };
}

/**
 * 答题结果 → 新进度条目。
 * clear：clearCount+1、consecutiveClear+1、间隔递增、nextReview = now + interval
 * unclear：unclearCount+1、consecutiveClear 清零、间隔 1 天（明天再来）
 */
export function applyResult(
  questionId: string,
  entry: ProgressEntry | null,
  result: "clear" | "unclear",
  now: Date,
): ProgressEntry {
  const e = entry ?? baseEntry(questionId);
  if (result === "clear") {
    e.clearCount += 1;
    e.consecutiveClear += 1;
    e.intervalDays = nextInterval(e.consecutiveClear);
    e.nextReviewDate = formatISO(addDays(now, e.intervalDays));
    e.lastReviewed = formatISO(now);
    return e;
  }
  e.unclearCount += 1;
  e.consecutiveClear = 0;
  e.intervalDays = 1;
  e.nextReviewDate = formatISO(addDays(now, 1));
  e.lastReviewed = formatISO(now);
  return e;
}

export interface TodayQueue {
  /** 今日新题（随机抽取，配额内） */
  newIntro: Question[];
  /** 到期复习题（nextReviewDate 的 startOfDay <= 今天的 startOfDay） */
  due: Question[];
}

export type QueueScope = "agent" | "all" | string[];

/**
 * 构建今日队列：新题在前 + 到期题在后（与 Swift loadTodayQueue 一致）。
 * 差异点（本 agent 的增强）：scope 控制新题抽取范围，
 * 默认 "agent"（只抽 agent 专题分类）；到期复习题不受 scope 限制（到期必复习）。
 */
export function buildTodayQueue(
  bank: { questions: Question[] },
  progressMap: ProgressMap,
  now: Date,
  opts: { quota?: number; scope?: QueueScope } = {},
): TodayQueue {
  const quota = opts.quota ?? DAILY_NEW_QUOTA;
  const today = startOfDay(now);

  const dueIds = new Set(
    [...progressMap.values()]
      .filter((e) => startOfDay(new Date(e.nextReviewDate)) <= today)
      .map((e) => e.questionId),
  );

  let pool = bank.questions.filter((q) => !progressMap.has(q.id));
  const scope = opts.scope ?? "agent";
  if (scope === "agent") {
    pool = pool.filter((q) => AGENT_CATEGORY_PREFIXES.some((p) => q.category.startsWith(p)));
  } else if (Array.isArray(scope)) {
    pool = pool.filter((q) => scope.includes(q.category));
  }

  const newIntro = shuffle(pool).slice(0, Math.min(quota, pool.length));
  const due = bank.questions.filter((q) => dueIds.has(q.id));
  return { newIntro, due };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Stats {
  total: number;
  reviewed: number;
  wrong: number;
  mastered: number;
}

/** 学习统计（与 Swift loadStats 一致） */
export function computeStats(progressMap: ProgressMap, total: number): Stats {
  let wrong = 0;
  let mastered = 0;
  for (const e of progressMap.values()) {
    if (e.unclearCount > 0) wrong++;
    if (isMastered(e)) mastered++;
  }
  return { total, reviewed: progressMap.size, wrong, mastered };
}

export function isMastered(e: ProgressEntry): boolean {
  return e.consecutiveClear >= 5;
}

export interface WrongEntry {
  question: Question;
  unclearCount: number;
  clearCount: number;
  lastReviewed: string | null;
}

/** 错题本：答错过的题按 unclearCount 降序（与 Swift loadWrongBook 一致） */
export function buildWrongBook(
  bank: { questions: Question[] },
  progressMap: ProgressMap,
  limit?: number,
): WrongEntry[] {
  const entries: WrongEntry[] = [];
  for (const q of bank.questions) {
    const p = progressMap.get(q.id);
    if (p && p.unclearCount > 0) {
      entries.push({
        question: q,
        unclearCount: p.unclearCount,
        clearCount: p.clearCount,
        lastReviewed: p.lastReviewed,
      });
    }
  }
  entries.sort((a, b) => b.unclearCount - a.unclearCount);
  return limit !== undefined ? entries.slice(0, limit) : entries;
}
