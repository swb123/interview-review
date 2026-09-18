import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

export interface Question {
  id: string;
  category: string;
  number: string;
  question: string;
  answer: string;
}

export interface QuestionBank {
  version: string;
  total: number;
  questions: Question[];
}

/** 加载题库（questions.json，与 SwiftUI app 共享同一文件） */
export function loadBank(path: string = join(config.dataDir, "questions.json")): QuestionBank {
  const raw = readFileSync(path, "utf8");
  const bank = JSON.parse(raw) as QuestionBank;
  if (!Array.isArray(bank.questions)) {
    throw new Error(`题库格式异常: ${path}`);
  }
  return bank;
}

export function byId(bank: QuestionBank, id: string): Question | undefined {
  return bank.questions.find((q) => q.id === id);
}

export function listCategories(bank: QuestionBank): string[] {
  const seen = new Set<string>();
  for (const q of bank.questions) {
    seen.add(q.category);
  }
  return [...seen];
}

export function inCategory(bank: QuestionBank, category: string): Question[] {
  return bank.questions.filter((q) => q.category === category);
}
