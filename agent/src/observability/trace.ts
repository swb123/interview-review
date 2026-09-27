import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { LoopStats } from "../llm/loop.js";

/**
 * 可观测性：每次 agent loop 结束追加一条 JSONL trace。
 * 只记元数据（模式/轮数/耗时/token/工具轨迹/判分通道），不记用户回答原文——
 * 够做延迟与成本分析，又不把个人作答落盘。`npm run trace:report` 做聚合。
 */

export interface TraceRecord {
  ts: string;
  mode: "judge" | "chat" | "interview" | "eval";
  model: string;
  questionId?: string;
  /** judge 专属：结构化输出走的通道 */
  via?: "tool" | "text" | "fallback";
  kind?: "end" | "max_iterations";
  iterations: number;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  truncations: number;
  tools: { name: string; ok: boolean; ms: number }[];
}

export function tracePath(): string {
  return process.env.TRACE_FILE ?? join(config.dataDir, "agent", "traces", "trace.jsonl");
}

export function writeTrace(
  rec: Omit<TraceRecord, "ts" | "model" | "iterations" | "elapsedMs" | "inputTokens" | "outputTokens" | "truncations" | "tools">,
  stats: LoopStats | undefined,
): void {
  if (process.env.TRACE === "off" || !stats) return;
  const full: TraceRecord = {
    ts: new Date().toISOString(),
    model: config.model,
    ...rec,
    iterations: stats.iterations,
    elapsedMs: stats.totalElapsedMs,
    inputTokens: stats.totalInputTokens,
    outputTokens: stats.totalOutputTokens,
    truncations: stats.truncations,
    tools: stats.toolCalls,
  };
  try {
    const p = tracePath();
    const dir = join(p, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(p, JSON.stringify(full) + "\n", "utf8");
  } catch {
    // trace 失败不影响主流程
  }
}

export function readTraces(path: string = tracePath()): TraceRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as TraceRecord];
      } catch {
        return [];
      }
    });
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
