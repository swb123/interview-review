import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// 加载 agent/.env：项目级配置优先于 shell 环境变量。
// 不用 process.loadEnvFile——它不覆盖已有变量，而在 Claude Code 等工具的终端里
// ANTHROPIC_BASE_URL 往往已被设成别的网关，会把请求（连同本项目的 token）发错地方。
// 按文件位置定位 .env，不依赖 cwd。
const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(ENV_FILE)) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync(ENV_FILE, "utf8")))) {
    if (v !== undefined) process.env[k] = v;
  }
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
