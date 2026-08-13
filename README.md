# 面试复习 V1

菜单栏应用：每天随机抽 5 道面试题，点「清楚」进入下一题，点「不清楚」显示标准答案。

## 使用

```bash
bash run.sh        # 构建并启动
# 或
swift run          # 直接运行
```

启动后看**菜单栏右上角 📖 图标**，点击弹出复习窗口。

## 题库更新

题库文件在 `~/interview-review/questions.json`（114 题，10 个分类）。

**更新方法**：重新运行解析脚本 `/tmp/parse_questions.py`，或直接编辑 JSON（格式见下）：

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

App 每次启动时读取该文件，更新题库无需重新编译。

## 项目结构

```
interview-review/
├── Package.swift                    # Swift Package 定义
├── run.sh                           # 一键启动
├── questions.json                   # 题库（114题）
└── Sources/InterviewReview/
    ├── InterviewReviewApp.swift     # App 入口（MenuBarExtra）
    ├── Models.swift                 # 数据模型 + 复习会话
    ├── QuestionLoader.swift         # 题库加载
    └── ReviewView.swift             # 复习卡片 UI
```

## V2 规划

- [ ] 接入语雀 API 自动拉取最新文章
- [ ] 间隔重复调度（清楚→2/4/7/15/30天，不清楚→明天再来）
- [ ] 系统通知定时提醒（10:00 / 15:00 / 21:00）
- [ ] 错题本与掌握度统计
