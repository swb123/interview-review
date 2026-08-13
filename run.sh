#!/bin/bash
# 面试复习 V1 启动脚本
cd "$(dirname "$0")"

# 1. 构建（如有新代码）
swift build 2>/dev/null

# 2. 启动
.build/debug/InterviewReview &
echo "✅ 已启动，看菜单栏右上角的 📖 图标"
