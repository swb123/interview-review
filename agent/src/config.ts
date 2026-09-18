import { homedir } from "node:os";
import { join } from "node:path";

// 加载 agent/.env（不存在则忽略，环境变量可由 shell 提供）
try {
  process.loadEnvFile?.(join(process.cwd(), ".env"));
} catch {
  // 无 .env 时走环境变量
}

export interface AppConfig {
  /** LLM 模型名（DeepSeek Anthropic 兼容端点，可配置，零硬编码 claude-*） */
  model: string;
  /** API 端点（ANTHROPIC_BASE_URL） */
  baseURL?: string;
  /** Bearer token（ANTHROPIC_AUTH_TOKEN） */
  authToken?: string;
  /** 是否回显 thinking 块（默认剥离——DeepSeek 端点默认开思考模式） */
  echoThinking: boolean;
  /** 数据目录（questions.json / progress.json 所在，与 SwiftUI app 共享） */
  dataDir: string;
  /** 判分输出上限（判分讲解较长，需显式给足） */
  judgeMaxTokens: number;
  /** 主会话输出上限 */
  chatMaxTokens: number;
}

export const config: AppConfig = {
  model: process.env.LLM_MODEL ?? "deepseek-v4-pro",
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  authToken: process.env.ANTHROPIC_AUTH_TOKEN || undefined,
  echoThinking: process.env.ECHO_THINKING === "true",
  dataDir: process.env.INTERVIEW_REVIEW_HOME ?? join(homedir(), "interview-review"),
  judgeMaxTokens: 8192,
  chatMaxTokens: 4096,
};
