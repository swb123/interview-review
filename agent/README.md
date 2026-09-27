# interview-review-agent

面试陪练 agent（TypeScript，不依赖 agent 框架，手写 agent loop）。既是 AI Agent 岗面试的备考工具，也是可以展开讲架构的面试作品。

- **模拟面试官**：面试官 agent 自主选题 → 提问 → 调判分子 agent → 按遗漏点追问 → 记录进度 → 输出结构化报告
- **AI 判分**：对照标准答案给出 掌握/未掌握 + 分数 + 覆盖/遗漏要点 + 讲解，三级兜底保证结构化输出
- **可量化**：自建标注评测集 + `npm run eval`；每次 loop 落 JSONL trace，`npm run trace:report` 出延迟/成本/工具成功率报表
- **间隔重复**：1→2→4→7→15→30 天调度，与 macOS 菜单栏 app 共享同一份题库和进度

## 评测结果

`deepseek-v4-pro`，33 条标注用例 × 3 次 = 99 次判分（2026-09-27，完整报告见 [eval/results/latest.md](eval/results/latest.md)）：

| 指标 | 值 |
|---|---|
| verdict 与标注一致率 | 100%（99/99） |
| 分数落在标注区间 | 93.9%（偏离的 6 次都是「部分正确」被打得偏低，判分偏严） |
| 误判为掌握（false clear） | 0% |
| 结构化输出成功率 | 100%（全部走 submit_judgement 工具通道） |
| 提示注入用例（3 类 × 3 次） | 9/9 判为未掌握，平均 4.8 分 |
| 重复判分分数标准差 | 1.4 分；verdict 翻转率 0% |
| 延迟 p50 / p95 | 12.9s / 18.1s |
| 每次判分 token（in / out） | 863 / 1166 |

> 局限：当前用例区分度偏易（好坏界限清楚），下一步补充「刚好及格/刚好不及格」的边界用例，一致率会更有参考价值。

复现：`npm run eval -- --repeat 3`（报告写入 `eval/results/latest.md`）。

## 快速开始

```bash
cd agent
npm install
cp .env.example .env        # 填 ANTHROPIC_AUTH_TOKEN（DeepSeek Anthropic 兼容端点）
npm start                   # 交互式主菜单
```

```bash
npm start -- --interview --count 3                           # 模拟面试（3 道主问题，面试官自主追问）
npm start -- --category "十一、Agent 基础与架构" --count 5   # 刷指定分类
npm start -- --agentic                                       # 答疑模式（自由对话 + 工具）
npm start -- --dry-run                                       # 任何模式都不写进度
```

## 架构

```
                     ┌──────────────── CLI（index.ts）────────────────┐
                     │                                                │
   今日复习/刷分类    │   模拟面试（agent 掌握控制流）     答疑（agent）   │
   代码编排，LLM 只判分 │                                                │
         │           │   interviewer.ts                 chatMode       │
         │           │   ├ load_today_queue / get_wrong_book  (读)     │
         │           │   ├ ask_candidate   ← human-in-the-loop         │
         │           │   ├ judge_answer ───┐                           │
         │           │   ├ record_result   │  (唯一写工具)             │
         │           │   └ finish_interview│  (zod 校验报告)           │
         ▼           └─────────────────────┼──────────────────────────┘
   judge.ts（判分子 agent，每题独立会话）◄──┘
   └ get_question(含标准答案的内部通道) → submit_judgement
                     │
          llm/loop.ts（手写 agent loop，所有模式共用）
                     │
          llm/client.ts ── DeepSeek Anthropic 兼容端点
                     │
   memory/progress.ts（长期：间隔重复进度）  memory/context.ts（会话：分层+压缩）
   observability/trace.ts（JSONL trace）      scheduler/（纯函数调度）
```

## 设计要点（面试讲点）

| 模块 | 文件 | 要点 |
|---|---|---|
| **手写 agent loop** | `src/llm/loop.ts` | 以 content 是否含 tool_use 判定循环（不信任 stop_reason）；并行工具执行、结果合并回填；工具异常 → `is_error` 回填让模型自纠；max_tokens 截断：纯文本续写 / 带工具时不执行可能残缺的最后一个调用，且保证不出现连续 user 消息；最大轮次护栏；轮数/token/工具耗时统计 |
| **自主决策 agent** | `src/interview/interviewer.ts` | 选题、是否追问、追问什么、何时结束都由模型决定；`ask_candidate` 是 human-in-the-loop 工具；**护栏写在代码里而非 prompt**：主问题数、单题追问数、只能判/记问过的题，越界返回 `is_error` |
| **子 agent + 信息隔离** | `src/judge/judge.ts` | 判分是独立会话的子 agent；面试官只拿到 verdict/分数/要点，拿不到标准答案和讲解原文，追问时无从泄题（有单测断言） |
| **结构化输出** | `src/judge/` | 三级兜底：`submit_judgement` 工具 → 文本 ```json 围栏 + zod 校验 → 用户自评；不依赖 forced tool_choice（兼容端点未必支持） |
| **Prompt 注入防护** | `src/judge/schema.ts` | 考生回答包在 `<candidate_answer>` 里并声明为数据；评测集含 3 类注入用例（伪系统指令 / 预填判分 JSON / 索要标准答案） |
| **工具安全边界** | `src/tools/handlers.ts` | `get_question` 公共通道永不返回答案；`record_result` 是唯一写工具，写入的是调度纯函数的结果而非 LLM 自由文本 |
| **上下文工程** | `src/memory/context.ts` | 以「一问一答」为单位保留完整工具轨迹；旧轮次工具结果截断（上下文编辑）；超阈值 LLM 摘要，摘要进 system 不占 user 轮；token 用真实 usage，缺失时用中英文分别估算 |
| **评估** | `eval/golden.json` + `scripts/eval-judge.ts` | 33 条标注用例（优秀/良好/部分/错误/跑题/空答/注入/冗长但错）；指标：一致率、区间命中、false clear 率、结构化成功率、重复判分稳定性、延迟、token |
| **可观测性** | `src/observability/trace.ts` | 每次 loop 一条 JSONL（只记元数据，不记作答原文）；`trace:report` 聚合 p50/p95、token、工具失败率、判分通道分布 |
| **可测试性** | `src/testing/mock-llm.ts` | `chat` 依赖注入 + 脚本化假 LLM；单测断言消息协议合法性（角色交替、tool_use/tool_result 配对） |
| **长期记忆** | `src/memory/progress.ts` | 原子写、写前合并、无毫秒 ISO（Swift `JSONDecoder` 解码契约） |
| **端点适配** | `src/llm/client.ts`, `src/config.ts` | thinking 块剥离、stop_reason 防御、400 排查摘要；项目 `.env` 优先于 shell 环境变量（避免被其他工具设置的网关劫持） |

## 依赖策略

运行依赖只有 `@anthropic-ai/sdk` + `zod`。不用 dotenv（`node:util` parseEnv）、不用 chalk、不用测试框架（`node:test`）、不用 Tool Runner / agent 框架。模型名不写死，通过 `LLM_MODEL` 配置。

## 开发

```bash
npm test                 # 单测（scheduler / loop / judge / context / interviewer，LLM 全部 mock）
npm run typecheck
npm run eval             # 判分评测（真实 LLM）
npm run trace:report     # trace 聚合报表
npm run smoke            # 单次判分探针
npm run check:compat     # Swift 进度文件兼容自检
npm run merge:questions  # seed/*.json 合并进 questions.json
```

## 题库维护

新题放 `seed/*.json`（`{categories:[{category, questions:[{number, question, answer}]}]}`），`npm run merge:questions` 自动校验（id 唯一/题面去重/围栏配对/长度上限）并合并，版本号自动 +0.1。

与 macOS app 共享 `~/interview-review/questions.json` / `progress.json`。CLI 与 app 不要同时使用（双方整文件读写，最后写者胜）。
