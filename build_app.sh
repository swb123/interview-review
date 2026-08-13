#!/bin/bash
# 打包为 .app 应用包（通知功能需要 app bundle 才生效）
set -e
cd "$(dirname "$0")"

APP_NAME="InterviewReview"
APP_DIR="$APP_NAME.app"

echo "1/4 编译..."
swift build -c release

echo "2/4 创建 .app 结构..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

echo "3/4 复制可执行文件和资源..."
cp .build/release/$APP_NAME "$APP_DIR/Contents/MacOS/"
cp questions.json "$APP_DIR/Contents/Resources/"

cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>面试复习</string>
    <key>CFBundleIdentifier</key>
    <string>com.interview.review</string>
    <key>CFBundleVersion</key>
    <string>2.0</string>
    <key>CFBundleShortVersionString</key>
    <string>2.0</string>
    <key>CFBundleExecutable</key>
    <string>InterviewReview</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
PLIST

echo "4/4 完成！"
echo ""
echo "使用方式："
echo "  open $APP_DIR          # 启动（通知功能生效）"
echo "  或把 $APP_DIR 拖到 /Applications/ 目录"
