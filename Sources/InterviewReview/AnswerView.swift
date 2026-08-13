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
                    // 代码块结束
                    if !codeBuffer.isEmpty {
                        blocks.append(.code(codeBuffer))
                    }
                    codeBuffer = ""
                    inCode = false
                } else {
                    // 代码块开始
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
        VStack(alignment: .leading, spacing: 8) {
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

// MARK: - 普通文本块（支持粗体/表格/列表的简化渲染）

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
                .lineSpacing(2)
        } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("+ ") {
            // 列表项
            HStack(alignment: .top, spacing: 6) {
                Text("•")
                    .font(.system(size: 12))
                RichTextLine(text: String(trimmed.dropFirst(2)))
            }
        } else if let num = matchedOrderedList(trimmed) {
            // 有序列表项
            HStack(alignment: .top, spacing: 6) {
                Text("\(num)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
                RichTextLine(text: String(trimmed.dropFirst(num.count + 2)))
            }
        } else if isSeparatorLine(trimmed) {
            // 表格分隔行（---）→ 不显示
            EmptyView()
        } else {
            RichTextLine(text: trimmed)
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
        // 匹配 "1. " "10. " 等前缀
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

// MARK: - 富文本行（粗体 + 行内代码）

struct RichTextLine: View {
    let text: String

    var body: some View {
        Text(attributedString)
            .font(.system(size: 12))
            .fixedSize(horizontal: false, vertical: true)
    }

    private var attributedString: AttributedString {
        var result = AttributedString()

        // 解析 **粗体** 与 `行内代码`
        var remaining = text
        while !remaining.isEmpty {
            if remaining.hasPrefix("**") {
                if let end = remaining.range(of: "**", range: remaining.index(remaining.startIndex, offsetBy: 2)..<remaining.endIndex) {
                    let boldText = String(remaining[remaining.index(remaining.startIndex, offsetBy: 2)..<end.lowerBound])
                    var attr = AttributedString(boldText)
                    attr.font = .system(size: 12, weight: .semibold)
                    result += attr
                    remaining = String(remaining[end.upperBound...])
                    continue
                }
            }

            if remaining.hasPrefix("`") {
                if let end = remaining.range(of: "`", range: remaining.index(after: remaining.startIndex)..<remaining.endIndex) {
                    let codeText = String(remaining[remaining.index(after: remaining.startIndex)..<end.lowerBound])
                    var attr = AttributedString(codeText)
                    attr.font = .system(size: 11, design: .monospaced)
                    attr.backgroundColor = Color.gray.opacity(0.2)
                    result += attr
                    remaining = String(remaining[end.upperBound...])
                    continue
                }
            }

            // 普通字符：找到下一个特殊标记
            if let nextMarker = findNextMarker(in: remaining) {
                let plainText = String(remaining[..<nextMarker])
                result += AttributedString(plainText)
                remaining = String(remaining[nextMarker...])
            } else {
                result += AttributedString(remaining)
                remaining = ""
            }
        }

        return result
    }

    private func findNextMarker(in text: String) -> String.Index? {
        let boldIdx = text.range(of: "**")
        let codeIdx = text.range(of: "`")
        switch (boldIdx, codeIdx) {
        case (nil, nil): return nil
        case (let b?, nil): return b.lowerBound
        case (nil, let c?): return c.lowerBound
        case (let b?, let c?): return b.lowerBound < c.lowerBound ? b.lowerBound : c.lowerBound
        }
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
