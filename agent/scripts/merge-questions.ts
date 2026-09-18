import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 题库合并脚本：agent/seed/*.json → ~/interview-review/questions.json
 *
 * 为什么不用 parse_questions.py：
 * 1. 用户 Python 3.9 环境已坏（litellm/pydantic 问题）
 * 2. 该脚本的围栏修复器是 Java 关键字专用，agent 题的 JS/TS 伪代码会被误判
 *
 * 校验（对齐 parse_questions.py 的规则）：id 唯一、题面去重（前 50 字）、
 * 代码围栏配对、答案长度上限。合并产物字段与 Swift Question/QuestionBank
 * Codable 完全一致，SwiftUI app 无需改代码即能读到新分类。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SEED_DIR = join(ROOT, "seed");
const BANK_PATH = join(ROOT, "..", "questions.json");
const MAX_ANSWER = 20000; // 对齐 parse_questions.py 的 MAX_ANSWER
const DEDUP_PREFIX = 50;

interface SeedQuestion {
  number: string;
  question: string;
  answer: string;
}
interface SeedCategory {
  category: string;
  questions: SeedQuestion[];
}
interface SeedFile {
  version: string;
  categories: SeedCategory[];
}
interface BankQuestion {
  id: string;
  category: string;
  number: string;
  question: string;
  answer: string;
}
interface Bank {
  version: string;
  total: number;
  questions: BankQuestion[];
}

function loadSeeds(): SeedFile[] {
  const files = readdirSync(SEED_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    console.error(`seed 目录为空: ${SEED_DIR}`);
    process.exit(1);
  }
  return files.map((f) => JSON.parse(readFileSync(join(SEED_DIR, f), "utf8")) as SeedFile);
}

/** 校验单个种子文件，返回错误列表 */
function validateSeed(seed: SeedFile): string[] {
  const errors: string[] = [];
  if (!Array.isArray(seed.categories)) return ["seed 缺少 categories 数组"];
  for (const cat of seed.categories) {
    if (!cat.category || !Array.isArray(cat.questions)) {
      errors.push(`分类格式异常: ${JSON.stringify(cat.category)}`);
      continue;
    }
    for (const q of cat.questions) {
      if (!/^Q\d+$/.test(q.number)) {
        errors.push(`${cat.category} 编号非法: ${q.number}`);
      }
      if (!q.question?.trim()) {
        errors.push(`${cat.category}-${q.number} 题目为空`);
      }
      if (!q.answer?.trim()) {
        errors.push(`${cat.category}-${q.number} 答案为空`);
      }
      const fences = (q.answer.match(/```/g) ?? []).length;
      if (fences % 2 !== 0) {
        errors.push(`${cat.category}-${q.number} 代码围栏不配对（${fences} 个）`);
      }
      if (q.answer.length > MAX_ANSWER) {
        errors.push(`${cat.category}-${q.number} 答案超长（${q.answer.length} > ${MAX_ANSWER}）`);
      }
    }
  }
  return errors;
}

function merge(bank: Bank, seeds: SeedFile[]): { added: number; skipped: string[] } {
  const existingIds = new Set(bank.questions.map((q) => q.id));
  const existingQuestions = new Set(
    bank.questions.map((q) => q.question.trim().slice(0, DEDUP_PREFIX)),
  );
  let added = 0;
  const skipped: string[] = [];

  for (const seed of seeds) {
    for (const cat of seed.categories) {
      for (const q of cat.questions) {
        const id = `${cat.category}-${q.number}`;
        if (existingIds.has(id)) {
          skipped.push(`${id}（id 重复）`);
          continue;
        }
        if (existingQuestions.has(q.question.trim().slice(0, DEDUP_PREFIX))) {
          skipped.push(`${id}（题面去重命中）`);
          continue;
        }
        bank.questions.push({
          id,
          category: cat.category,
          number: q.number,
          question: q.question.trim(),
          answer: q.answer.trim(),
        });
        existingIds.add(id);
        existingQuestions.add(q.question.trim().slice(0, DEDUP_PREFIX));
        added++;
      }
    }
  }
  return { added, skipped };
}

function bumpVersion(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)$/);
  if (!m) return "2.0";
  return `${m[1]}.${Number(m[2]) + 1}`;
}

function main(): void {
  const seeds = loadSeeds();

  const errors = seeds.flatMap(validateSeed);
  if (errors.length > 0) {
    console.error("seed 校验失败：");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const bank = JSON.parse(readFileSync(BANK_PATH, "utf8")) as Bank;
  const before = bank.questions.length;

  const { added, skipped } = merge(bank, seeds);
  if (skipped.length > 0) {
    console.warn("跳过：");
    for (const s of skipped) console.warn(`  - ${s}`);
  }

  bank.total = bank.questions.length;
  bank.version = bumpVersion(bank.version);

  const tmp = BANK_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(bank, null, 2), "utf8");
  renameSync(tmp, BANK_PATH);

  const byCat = new Map<string, number>();
  for (const q of bank.questions) {
    byCat.set(q.category, (byCat.get(q.category) ?? 0) + 1);
  }
  console.log(`合并完成：${before} → ${bank.questions.length} 题（+${added}），版本 ${bank.version}`);
  for (const [cat, n] of byCat) console.log(`  ${cat}: ${n}`);
}

main();
