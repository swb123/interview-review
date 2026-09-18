import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

export interface ProgressEntry {
  questionId: string;
  consecutiveClear: number;
  intervalDays: number;
  nextReviewDate: string; // ISO 8601 无毫秒，如 2026-08-29T15:41:13Z
  clearCount: number;
  unclearCount: number;
  lastReviewed: string | null;
}

export type ProgressMap = Map<string, ProgressEntry>;

/**
 * Swift 兼容日期格式：JSONEncoder .iso8601 无毫秒。
 * 带毫秒的日期 Swift 端解码会整体失败 → 静默清空进度，所以必须截断。
 */
export function formatISO(date: Date): string {
  return date.toISOString().slice(0, 19) + "Z";
}

/** 加载进度：文件缺失/损坏 → 空 Map + 告警（与 Swift 解码失败降级行为一致） */
export function loadProgress(path: string = join(config.dataDir, "progress.json")): ProgressMap {
  const map = new Map<string, ProgressEntry>();
  if (!existsSync(path)) {
    return map;
  }
  try {
    const arr = JSON.parse(readFileSync(path, "utf8")) as ProgressEntry[];
    for (const e of arr) {
      if (e && typeof e.questionId === "string") {
        map.set(e.questionId, e);
      }
    }
  } catch (err) {
    console.warn(`[progress] 读取失败，已按空进度处理: ${(err as Error).message}`);
  }
  return map;
}

/** 保存进度：按 questionId 排序 + 原子写（tmp + rename，对齐 Swift .atomic） */
export function saveProgress(
  map: ProgressMap,
  path: string = join(config.dataDir, "progress.json"),
): void {
  const arr = [...map.values()].sort((a, b) => (a.questionId < b.questionId ? -1 : 1));
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf8");
  renameSync(tmp, path);
}

/**
 * 更新单题进度。写前重新 load 并合并——降低与 macOS app 并发使用时的互踩概率
 * （双方都是"读全文件→改一条→整文件写"，最后写者胜，但至少不会用过期快照覆盖）。
 */
export function updateProgress(
  questionId: string,
  transform: (entry: ProgressEntry | null) => ProgressEntry,
  path?: string,
): ProgressEntry {
  const map = loadProgress(path);
  const next = transform(map.get(questionId) ?? null);
  map.set(questionId, next);
  saveProgress(map, path);
  return next;
}
