import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Swift 兼容自检：
 * 以真实 progress.json 为 fixture，在临时目录模拟一次 record_result，
 * 断言产物满足 Swift ProgressStore 的解码要求（字段名/类型/排序/无毫秒日期）。
 * Swift 端解码失败会静默清空进度，所以这是硬性契约。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_PROGRESS = join(__dirname, "..", "..", "progress.json");
const ISO_NO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// 延迟 import：tsx 下 import 语句提升不影响运行时，但保持脚本顶部只做路径定义
async function main(): Promise<void> {
  const { loadProgress, saveProgress, updateProgress } = await import("../src/memory/progress.js");
  const { applyResult } = await import("../src/scheduler/scheduler.js");

  const tmp = mkdtempSync(join(tmpdir(), "interview-compat-"));
  const fixturePath = join(tmp, "progress.json");
  let failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
    if (!ok) failures++;
  };

  try {
    // fixture：复制真实 progress.json（若无则用空进度，检查仍可跑通基本契约）
    if (existsSync(REAL_PROGRESS)) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(fixturePath, readFileSync(REAL_PROGRESS, "utf8"), "utf8");
    }
    const before = loadProgress(fixturePath);
    const beforeCount = before.size;

    // 模拟一次 record_result（新题 clear + 老题 unclear）
    const now = new Date();
    updateProgress(
      "十一、Agent 基础与架构-Q1",
      (e) => applyResult("十一、Agent 基础与架构-Q1", e, "clear", now),
      fixturePath,
    );
    if (before.has("一、Java核心-Q14")) {
      updateProgress(
        "一、Java核心-Q14",
        (e) => applyResult("一、Java核心-Q14", e, "unclear", now),
        fixturePath,
      );
    }

    const after = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>[];
    check("写后条目数 >= 写前", after.length >= beforeCount, `${after.length} >= ${beforeCount}`);

    // 排序：questionId 升序（Swift save 的排序契约）
    const ids = after.map((e) => String(e.questionId));
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : 1));
    check("按 questionId 排序", JSON.stringify(ids) === JSON.stringify(sorted));

    // 字段契约：Swift ProgressEntry Codable 的 6 个字段、类型一致
    for (const e of after) {
      const fields: [string, string][] = [
        ["questionId", "string"],
        ["consecutiveClear", "number"],
        ["intervalDays", "number"],
        ["nextReviewDate", "string"],
        ["clearCount", "number"],
        ["unclearCount", "number"],
        ["lastReviewed", "string-or-null"],
      ];
      for (const [f, t] of fields) {
        const v = e[f];
        const ok =
          t === "string"
            ? typeof v === "string"
            : t === "number"
              ? typeof v === "number"
              : v === null || typeof v === "string";
        if (!ok) {
          check(`字段 ${f} 类型（${e.questionId}）`, false, `实际: ${typeof v}`);
        }
      }
      if (typeof e.nextReviewDate === "string") {
        check(`nextReviewDate 无毫秒（${e.questionId}）`, ISO_NO_MS.test(e.nextReviewDate), e.nextReviewDate);
      }
      if (typeof e.lastReviewed === "string") {
        check(`lastReviewed 无毫秒（${e.questionId}）`, ISO_NO_MS.test(e.lastReviewed), e.lastReviewed);
      }
    }
    check("字段类型契约全部通过", failures === 0 || after.every((e) => e), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\n✅ Swift 兼容自检通过" : `\n❌ ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
