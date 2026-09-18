# 面试复习 (V2)

macOS 菜单栏应用：基于间隔重复算法的面试题库自测工具。

## 功能

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

## 开发运行

```bash
swift run                # 开发模式（无通知，其他功能正常）
bash build_app.sh        # 打包 .app
open InterviewReview.app # 完整模式（通知生效）
```

## 项目结构

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

## 题库更新

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

## Agent 版（AI 判分陪练）

菜单栏 app 的兄弟项目：独立 agent CLI，手写 agent loop + 工具调用 + 结构化判分 + 间隔重复调度，覆盖 agent 岗面试场景（详情见 [agent/README.md](agent/README.md)）：

```bash
cd agent && npm install
cp .env.example .env   # 复用 DeepSeek Anthropic 兼容端点
npm start              # 1 今日复习 / 2 刷分类 / 3 错题本 / 4 统计 / 5 答疑
npm start -- --category "十一、Agent 基础与架构" --count 5
```

与 app 共享同一份 `questions.json` / `progress.json`，数据格式完全兼容（注意：不要同时使用）。

## V3 规划

- [ ] 接入语雀 API 自动拉取最新文章（需个人令牌）
- [ ] 点击通知直接打开复习窗口
- [x] Agent 版：AI 判分陪练 CLI（`agent/`，含 agent 专题题库十一~十六）
