# interview-review-agent

独立面试陪练 agent（TypeScript，手写 agent loop）。既是 agent/AI 岗面试的备考工具，也是可展开讲架构的面试作品。

## 快速开始

```bash
cd ~/interview-review/agent
npm install
cp .env.example .env        # 填 ANTHROPIC_AUTH_TOKEN（复用 DeepSeek 端点，与 Claude Code 同一套）
npm start                   # 交互式主菜单
```

常用参数：

```bash
npm start -- --category "十一、Agent 基础与架构" --count 5   # 直接刷指定分类 5 题
npm start -- --dry-run                                       # 判分但不写进度（试玩/冒烟）
npm start -- --agentic                                       # 答疑模式（自由对话，展示完整 loop）
npm run smoke                                                # LLM 行为探针（单次判分原始响应）
```

数据与 macOS 菜单栏 app 共享：`~/interview-review/questions.json`（题库）与 `progress.json`（间隔重复进度），格式不变，双向兼容。注意：CLI 与 app 不要同时使用（双方都整文件读写，最后写者胜）。

## 功能

- **今日复习**：新题 5 道（默认只从 agent 专题十一~十六抽取）+ 到期复习题，间隔重复调度 1→2→4→7→15→30 天
- **刷指定分类**：全题库任意分类（含旧的 138 道后端题）
- **判分**：AI 对照标准答案给出 掌握/未掌握 + 0-100 分 + 覆盖/遗漏要点 + 讲解 + 建议
- **错题本 / 统计**：答错次数排序；已学/错题/掌握看板
- **答疑模式**：自由对话，agent 自主调用工具（查队列/查统计/记进度）

## 架构（面试讲点）

```
用户 ⇄ CLI（确定性编排）
        ├─ 判分：judge.ts ──→ mini agent loop（每题独立会话）
        │     └─ 工具: get_question(内部通道含答案) → submit_judgement
        └─ 答疑：llm/loop.ts ──→ 完整 agent loop + 5 个公共工具
```

| 模块 | 文件 | 面试考点 |
|---|---|---|
| **手写 agent loop** | `src/llm/loop.ts` | 循环条件、停止条件、并行工具执行、`is_error` 回填、max_tokens 截断续写、最大轮次护栏、可观测性统计 |
| **工具调用** | `src/tools/handlers.ts` | schema 设计（手写 input_schema）、命名/描述、入参校验、幂等 |
| **安全边界** | 同上 | `get_question` 公共通道**永不返回标准答案**（答案只走 judge 内部通道）；`record_result` 是唯一写工具，写的是纯函数计算结果而非 LLM 自由文本 |
| **结构化输出** | `src/judge/` | 三保险：`submit_judgement` 工具 → 文本 ```json 围栏 + zod 校验 → 自评兜底（零 LLM 仍可用）；不依赖 forced tool_choice / Anthropic 私有特性（跨端点） |
| **子 agent 上下文隔离** | `src/judge/judge.ts` | 判分每题独立会话，不带主会话历史——压缩压力减半、成本可控 |
| **记忆（长期）** | `src/memory/progress.ts` | 间隔重复进度持久化：原子写、写前合并（并发互踩）、无毫秒 ISO（Swift 解码契约） |
| **记忆（会话）** | `src/memory/context.ts` | 上下文分层 + 滚动窗口（保留 6 轮）+ 超阈值 LLM 摘要压缩 |
| **规划/调度** | `src/scheduler/scheduler.ts` | 间隔重复调度纯函数：时间注入可测、逐字段对齐 Swift 原实现 |
| **评估** | `src/judge/schema.ts` | 判分标准 prompt + zod schema；`scripts/check-compat.ts` 做数据契约回归 |
| **端点适配** | `src/llm/client.ts` | DeepSeek Anthropic 兼容端点的坑：thinking 剥离、stop_reason 防御、400 排查摘要 |

## 依赖策略（也是谈资）

- 运行依赖只有 `@anthropic-ai/sdk` + `zod`；不用 dotenv（Node 22 `process.loadEnvFile`）、不用 chalk（4 个 ANSI 常量）、不用测试框架（`node:test`）、不用 Tool Runner（loop 自己写）
- 模型名零硬编码 claude-*：`LLM_MODEL` 环境变量（默认 `deepseek-v4-pro`），端点经 `ANTHROPIC_BASE_URL` 指向 DeepSeek Anthropic 兼容 API

## 开发

```bash
npm test           # scheduler 单测（node:test）
npm run check:compat   # Swift 进度文件兼容自检
npm run merge:questions  # seed/*.json 合并进 questions.json
npx tsc --noEmit   # 类型检查
```

## 题库维护

新题放 `seed/*.json`（`{categories:[{category, questions:[{number, question, answer}]}]}`），`npm run merge:questions` 自动校验（id 唯一/题面去重/围栏配对/长度上限）并合并，版本号自动 +0.1。
