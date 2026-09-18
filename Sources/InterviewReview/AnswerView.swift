import SwiftUI

/// 答案块类型
enum AnswerBlock: Identifiable {
    case text(String)
    case code(String)
    case table(AnswerTable)

    var id: String { UUID().uuidString }
}

// MARK: - 表格模型

struct AnswerTable: Identifiable {
    struct Row: Identifiable {
        let id = UUID()
        let cells: [String]
        let isHeader: Bool
    }

    let rows: [Row]
    let columns: Int

    var id: String { UUID().uuidString }
}

/// 解析 markdown 答案为渲染块（代码块 / 表格 / 普通文本）
enum AnswerParser {

    static func parse(_ markdown: String) -> [AnswerBlock] {
        var blocks: [AnswerBlock] = []
        var textBuffer = ""
        var inCode = false
        var codeBuffer = ""
        var tableLines: [String] = []

        func flushText() {
            let trimmed = textBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                blocks.append(.text(trimmed))
            }
            textBuffer = ""
        }

        func flushTable() {
            defer { tableLines = [] }
            guard !tableLines.isEmpty else { return }

            // 找分隔行位置：分隔行之前的行为表头，之后为数据行
            var separatorIndex: Int?
            for (i, line) in tableLines.enumerated() where isSeparatorLine(line) {
                separatorIndex = i
                break
            }

            var rows: [AnswerTable.Row] = []
            let headerRowIndex: Int?
            let bodyStart: Int
            if let sep = separatorIndex {
                headerRowIndex = sep > 0 ? sep - 1 : nil
                bodyStart = sep + 1
            } else {
                headerRowIndex = 0   // 无分隔行时第 0 行作表头
                bodyStart = 1
            }
            if let h = headerRowIndex, h < tableLines.count {
                let cells = splitCells(tableLines[h])
                if !cells.isEmpty {
                    rows.append(AnswerTable.Row(cells: cells, isHeader: true))
                }
            }
            for i in bodyStart..<tableLines.count where !isSeparatorLine(tableLines[i]) {
                let cells = splitCells(tableLines[i])
                if !cells.isEmpty {
                    rows.append(AnswerTable.Row(cells: cells, isHeader: false))
                }
            }

            let columns = rows.map { $0.cells.count }.max() ?? 1
            let normalized = rows.map { row in
                var cells = row.cells
                while cells.count < columns { cells.append("") }
                return AnswerTable.Row(cells: Array(cells.prefix(columns)), isHeader: row.isHeader)
            }
            blocks.append(.table(AnswerTable(rows: normalized, columns: columns)))
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
                    flushTable()
                    inCode = true
                }
            } else if inCode {
                codeBuffer += line + "\n"
            } else if isTableLine(line) {
                flushText()
                tableLines.append(line)
            } else {
                if !tableLines.isEmpty {
                    flushTable()
                }
                textBuffer += line + "\n"
            }
        }

        if inCode && !codeBuffer.isEmpty {
            blocks.append(.code(codeBuffer))
        }
        flushTable()
        flushText()

        return blocks
    }

    // MARK: 表格行识别

    static func isTableLine(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return t.hasPrefix("|") && t.hasSuffix("|")
    }

    static func isSeparatorLine(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard isTableLine(t) else { return false }
        let inner = t.dropFirst().dropLast()
            .replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "|", with: "")
        return inner.isEmpty && t.contains("-")
    }

    static func splitCells(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|") { s.removeLast() }
        // 保护转义的管道符
        let placeholder = "\u{0001}"
        s = s.replacingOccurrences(of: "\\|", with: placeholder)
        return s.components(separatedBy: "|").map {
            $0.replacingOccurrences(of: placeholder, with: "|")
                .trimmingCharacters(in: .whitespaces)
        }
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
                case .table(let table):
                    TableBlockView(table: table)
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
        } else if AnswerParser.isTableLine(trimmed) {
            // 兜底：未成表格块的管道行 → 等宽字体（管道对齐天然好看）
            Text(trimmed)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        } else if AnswerParser.isSeparatorLine(trimmed) {
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

// MARK: - 表格块（网格渲染：对齐列 + 边框 + 表头底色 + 单元格换行）

struct TableBlockView: View {
    let table: AnswerTable

    var body: some View {
        // 直接渲染，不包横向 ScrollView —— 包了之后 Grid 在弹窗/渲染器中
        // 会失去列宽分配和边框（4 列以上表格整体损坏）。单元格文字会自动换行。
        grid
    }

    private var grid: some View {
        // 用原生 Grid（macOS 13+）做行列布局：跨行对齐、行高一致。
        // 注意：单元格不能加 .textSelection —— 每个可选中 Text 会变成
        // 独立 SelectionTextField 平台视图，在弹窗里互相重叠错位。
        Grid(horizontalSpacing: 0, verticalSpacing: 0) {
            ForEach(table.rows) { row in
                GridRow {
                    ForEach(Array(row.cells.enumerated()), id: \.offset) { ci, cell in
                        TableCellText(text: cell)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 5)
                            .background(row.isHeader ? Color.secondary.opacity(0.15) : Color.clear)
                            .overlay(alignment: .trailing) {
                                if ci < row.cells.count - 1 {
                                    Rectangle()
                                        .fill(Color.secondary.opacity(0.3))
                                        .frame(width: 1)
                                }
                            }
                    }
                }
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                }
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

/// 表格单元格纯文本（无独立选区控件，保证网格布局稳定）
struct TableCellText: View {
    let text: String

    var body: some View {
        Text(markdownAttributed)
            .font(.system(size: 11))
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

// MARK: - 单行富文本（SwiftUI 原生 Markdown 解析，无重叠问题）

struct MarkdownTextLine: View {
    let text: String
    var fontSize: CGFloat = 12

    var body: some View {
        // 使用 SwiftUI 原生 markdown 解析（**粗体**、`行内代码`），
        // 系统渲染路径，避免自定义 AttributedString 在弹窗中的重叠 bug
        Text(markdownAttributed)
            .font(.system(size: fontSize))
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
