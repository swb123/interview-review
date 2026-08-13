import SwiftUI

/// 答案块类型
enum AnswerBlock: Identifiable {
    case text(String)
    case code(String)

    var id: String { UUID().uuidString }
}

/// 解析 markdown 答案为渲染块（代码块 / 普通文本）
enum AnswerParser {

    static func parse(_ markdown: String) -> [AnswerBlock] {
        var blocks: [AnswerBlock] = []
        var textBuffer = ""
        var inCode = false
        var codeBuffer = ""

        func flushText() {
            let trimmed = textBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                blocks.append(.text(trimmed))
            }
            textBuffer = ""
        }

        for line in markdown.components(separatedBy: "\n") {
            if line.hasPrefix("```") {
                if inCode {
                    if !codeBuffer.isEmpty {
                        blocks.append(.code(codeBuffer))
                    }
                    codeBuffer = ""
                    inCode = false
                } else {
                    flushText()
                    inCode = true
                }
            } else if inCode {
                codeBuffer += line + "\n"
            } else {
                textBuffer += line + "\n"
            }
        }

        if inCode && !codeBuffer.isEmpty {
            blocks.append(.code(codeBuffer))
        }
        flushText()

        return blocks
    }
}

/// 答案渲染视图（纯 SwiftUI，兼容 MenuBarExtra 弹窗）
struct AnswerView: View {
    let markdown: String

    private var blocks: [AnswerBlock] {
        AnswerParser.parse(markdown)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(blocks) { block in
                switch block {
                case .text(let text):
                    TextBlockView(text: text)
                case .code(let code):
                    CodeBlockView(code: code)
                }
            }
        }
    }
}

// MARK: - 普通文本块

struct TextBlockView: View {
    let text: String

    var body: some View {
        let lines = text.components(separatedBy: "\n")

        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                renderLine(line)
            }
        }
    }

    @ViewBuilder
    private func renderLine(_ line: String) -> some View {
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        if trimmed.isEmpty {
            EmptyView()
        } else if isTableLine(trimmed) {
            // 表格行 → 等宽字体（管道对齐天然好看）
            Text(trimmed)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        } else if isSeparatorLine(trimmed) {
            // 表格分隔行（---）→ 不显示
            EmptyView()
        } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("+ ") {
            // 无序列表
            HStack(alignment: .top, spacing: 6) {
                Text("•")
                    .font(.system(size: 12))
                MarkdownTextLine(text: String(trimmed.dropFirst(2)))
            }
        } else if let num = matchedOrderedList(trimmed) {
            // 有序列表
            HStack(alignment: .top, spacing: 6) {
                Text("\(num)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                MarkdownTextLine(text: String(trimmed.dropFirst(num.count + 2)))
            }
        } else {
            MarkdownTextLine(text: trimmed)
        }
    }

    private func isTableLine(_ line: String) -> Bool {
        line.hasPrefix("|") && line.hasSuffix("|")
    }

    private func isSeparatorLine(_ line: String) -> Bool {
        let stripped = line.replacingOccurrences(of: "|", with: "")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ":", with: "")
        return !stripped.isEmpty && stripped.allSatisfy { $0 == "-" }
    }

    private func matchedOrderedList(_ line: String) -> String? {
        var digits = ""
        for ch in line {
            if ch.isNumber {
                digits.append(ch)
            } else if ch == "." && !digits.isEmpty {
                return digits
            } else {
                return nil
            }
        }
        return nil
    }
}

// MARK: - 单行富文本（SwiftUI 原生 Markdown 解析，无重叠问题）

struct MarkdownTextLine: View {
    let text: String

    var body: some View {
        // 使用 SwiftUI 原生 markdown 解析（**粗体**、`行内代码`），
        // 系统渲染路径，避免自定义 AttributedString 在弹窗中的重叠 bug
        Text(markdownAttributed)
            .font(.system(size: 12))
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var markdownAttributed: AttributedString {
        (try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        )) ?? AttributedString(text)
    }
}

// MARK: - 代码块（深色背景 + 等宽字体 + 横向滚动）

struct CodeBlockView: View {
    let code: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(code)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.white)
                .padding(12)
                .textSelection(.enabled)
                .fixedSize(horizontal: true, vertical: false)
        }
        .background(Color.black.opacity(0.85))
        .cornerRadius(8)
    }
}
