# 面试复习：AI 面试陪练 Agent + macOS 菜单栏 App

两个共享同一份题库（188 题）与学习进度的子项目：

| 子项目 | 技术栈 | 说明 |
|---|---|---|
| [**agent/**](agent/README.md) | TypeScript · Anthropic SDK · DeepSeek | **面试陪练 agent**：手写 agent loop；模拟面试官自主选题、追问并出报告；AI 判分（三级结构化兜底）；标注评测集；JSONL trace |
| 根目录（本文档） | Swift · SwiftUI | macOS 菜单栏卡片式自测 app：间隔重复、定时通知、错题本 |

```bash
cd agent && npm install && cp .env.example .env
npm start -- --interview      # 模拟面试
npm run eval                  # 判分评测
```

---

## macOS 菜单栏 App

### 功能

**V1**
- 📖 菜单栏卡片式答题：点「清楚」下一题，点「不清楚」显示标准答案
- 题库 120 题（10 个分类），从语雀 P7 面试知识库解析
- 题库热更新：改 `~/interview-review/questions.json` 无需重新编译
- 答案渲染：代码块（深色背景 + 横向滚动）、表格（网格对齐 + 表头底色）、列表、加粗/行内代码

**V2.1 间隔重复**
- 清楚 → 间隔递增：1天 → 2天 → 4天 → 7天 → 15天 → 30天
- 不清楚 → 明天再来
- 每日队列 = 5 道新题 + 到期复习题
- 进度持久化：`~/interview-review/progress.json`

**V2.2 定时通知 + 错题本 + 统计**
- 每天 10:00 / 15:00 / 21:00 系统通知提醒
- 错题本：答错过的题按次数排序，可展开看答案
- 统计面板：题库 / 已学 / 错题 / 掌握，点击卡片查看题目明细
- ⚠️ 需以 .app 形式运行（见下方"打包运行"）

### 开发运行

```bash
swift run                # 开发模式（无通知，其他功能正常）
bash build_app.sh        # 打包 .app
open InterviewReview.app # 完整模式（通知生效）
```

### 项目结构

```
interview-review/
├── Package.swift                    # Swift Package 定义
├── build_app.sh                     # 打包 .app 脚本
├── run.sh                           # 开发模式一键启动
├── questions.json                   # 题库（120题）
├── articles/                        # 语雀文章 markdown 数据源（10篇）
├── scripts/
│   └── parse_questions.py           # 解析脚本：articles/*.md → questions.json
└── Sources/InterviewReview/
    ├── InterviewReviewApp.swift     # App 入口 + 通知授权
    ├── Models.swift                 # 数据模型 + 间隔重复调度核心
    ├── ProgressStore.swift          # 学习进度持久化
    ├── QuestionLoader.swift         # 题库加载
    ├── NotificationManager.swift    # 每日定时通知
    ├── ReviewView.swift             # 复习卡片 UI
    ├── AnswerView.swift             # 答案渲染（代码块/表格/列表）
    ├── QuestionListView.swift       # 题目列表
    ├── WrongBookView.swift          # 错题本
    └── StatsView.swift              # 统计面板
```

### 题库更新

1. 更新 `articles/` 下的语雀文章（markdown，支持 HTML/markdown 表格）
2. 运行解析脚本：

```bash
python3 ~/interview-review/scripts/parse_questions.py
```

脚本会自动：HTML 表格 → markdown 表格、补齐表格分隔行、修复代码围栏、去重校验。

JSON 格式：
```json
{
  "version": "1.1",
  "total": 120,
  "questions": [
    {
      "id": "一、Java核心-Q1",
      "category": "一、Java核心",
      "number": "Q1",
      "question": "题目",
      "answer": "答案"
    }
  ]
}
```

## V3 规划

- [ ] 接入语雀 API 自动拉取最新文章（需个人令牌）
- [ ] 点击通知直接打开复习窗口
- [x] Agent 版：AI 判分陪练 CLI（`agent/`，含 agent 专题题库十一~十六）
- [x] Agent 版：模拟面试官模式、判分评测集、trace 可观测性
