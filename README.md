# 面试复习 (V2)

macOS 菜单栏应用：基于间隔重复算法的面试题库自测工具。

## 功能

**V1**
- 📖 菜单栏卡片式答题：点「清楚」下一题，点「不清楚」显示标准答案
- 题库 114 题（10 个分类），从语雀 P7 面试知识库解析
- 题库热更新：改 `~/interview-review/questions.json` 无需重新编译

**V2.1 间隔重复**
- 清楚 → 间隔递增：1天 → 2天 → 4天 → 7天 → 15天 → 30天
- 不清楚 → 明天再来
- 每日队列 = 5 道新题 + 到期复习题
- 进度持久化：`~/interview-review/progress.json`

**V2.2 定时通知**
- 每天 10:00 / 15:00 / 21:00 系统通知提醒
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
├── questions.json                   # 题库（114题）
└── Sources/InterviewReview/
    ├── InterviewReviewApp.swift     # App 入口 + 通知授权
    ├── Models.swift                 # 数据模型 + 间隔重复调度核心
    ├── ProgressStore.swift          # 学习进度持久化
    ├── QuestionLoader.swift         # 题库加载
    ├── NotificationManager.swift    # 每日定时通知
    └── ReviewView.swift             # 复习卡片 UI
```

## 题库更新

解析脚本（Python）：`/tmp/parse_questions.py`（需配合本地语雀文章 markdown 文件）

JSON 格式：
```json
{
  "version": "1.0",
  "total": 114,
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
- [ ] 错题本与掌握度统计面板
- [ ] 点击通知直接打开复习窗口
