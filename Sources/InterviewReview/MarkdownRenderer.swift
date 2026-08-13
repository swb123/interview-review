import Foundation

/// 轻量 Markdown → HTML 渲染器
/// 支持：代码块（含语言标注）、表格、标题、列表、粗体、链接、行内代码
enum MarkdownRenderer {

    static func renderHTML(_ markdown: String) -> String {
        var md = markdown

        // 1. 提取代码块（优先处理，防止内部内容被其他规则破坏）
        var codeBlocks: [String] = []
        let codeRegex = #/```[a-zA-Z]*\n([\s\S]*?)```/#
        md = md.replacing(codeRegex) { match in
            codeBlocks.append(String(match.1))
            return "\u{0001}CODE\(codeBlocks.count - 1)\u{0001}"
        }

        // 2. HTML 转义（代码块占位符已保护）
        md = escapeHTML(md)

        // 3. 表格 → HTML table
        md = renderTables(md)

        // 4. 标题
        md = md.replacing(#/(?m)^####\s+(.+)$/#) { m in "<h4>\(m.1)</h4>" }
        md = md.replacing(#/(?m)^###\s+(.+)$/#) { m in "<h3>\(m.1)</h3>" }
        md = md.replacing(#/(?m)^##\s+(.+)$/#) { m in "<h2>\(m.1)</h2>" }
        md = md.replacing(#/(?m)^#\s+(.+)$/#) { m in "<h1>\(m.1)</h1>" }

        // 5. 粗体
        md = md.replacing(#/\*\*(.+?)\*\*/#) { m in "<strong>\(m.1)</strong>" }

        // 6. 行内代码
        md = md.replacing(#/`([^`\n]+)`/#) { m in "<code>\(m.1)</code>" }

        // 7. 链接 [text](url)
        md = md.replacing(#/\[([^\]]+)\]\(([^)]+)\)/#) { m in "<a href=\"\(m.2)\">\(m.1)</a>" }

        // 8. 无序列表（- 或 + 开头）
        md = renderUnorderedList(md)

        // 9. 有序列表（数字. 开头）
        md = renderOrderedList(md)

        // 10. 引用块
        md = md.replacing(#/(?m)^&gt;\s?(.+)$/#) { m in "<blockquote>\(m.1)</blockquote>" }

        // 11. 分隔线
        md = md.replacing(#/(?m)^\s*---+\s*$/#) { _ in "<hr>" }

        // 12. 普通段落：连续换行 → <p>
        md = renderParagraphs(md)

        // 13. 恢复代码块
        for (i, code) in codeBlocks.enumerated() {
            let lang = detectLanguage(code)
            let escaped = escapeHTML(code)
            let langLabel = lang.map { "<span class=\"code-lang\">\($0)</span>" } ?? ""
            let block = "<div class=\"code-block\">\(langLabel)<pre><code>\(escaped)</code></pre></div>"
            md = md.replacingOccurrences(of: "\u{0001}CODE\(i)\u{0001}", with: block)
        }

        return md
    }

    // MARK: - 各元素渲染

    private static func renderTables(_ md: String) -> String {
        var result = md
        // 匹配连续的表格行（含分隔行）
        let tableRegex = #/(?m)((^\|.*\|\s*$\n)+)/#
        result = result.replacing(tableRegex) { match in
            let block = String(match.1)
            let lines = block.split(separator: "\n")
            guard lines.count >= 2 else { return String(block) }

            var html = "<table>"
            var isHeader = true
            for (idx, line) in lines.enumerated() {
                let cells = parseTableRow(String(line))
                if isHeader {
                    html += "<thead><tr>"
                    for cell in cells { html += "<th>\(cell)</th>" }
                    html += "</tr></thead><tbody>"
                    isHeader = false
                } else if idx == 1 && isSeparatorRow(String(line)) {
                    continue
                } else {
                    html += "<tr>"
                    for cell in cells { html += "<td>\(cell)</td>" }
                    html += "</tr>"
                }
            }
            html += "</tbody></table>"
            return html
        }
        return result
    }

    private static func parseTableRow(_ line: String) -> [String] {
        var cells = line.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        if cells.first?.trimmingCharacters(in: .whitespaces).isEmpty == true { cells.removeFirst() }
        if cells.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { cells.removeLast() }
        return cells.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func isSeparatorRow(_ line: String) -> Bool {
        let cells = parseTableRow(line)
        return cells.allSatisfy { cell in
            cell.allSatisfy { $0 == "-" || $0 == ":" || $0 == " " }
        }
    }

    private static func renderUnorderedList(_ md: String) -> String {
        var result = md
        let listRegex = #/(?m)((^\s*[-+]\s+.+$\n)+)/#
        result = result.replacing(listRegex) { match in
            let block = String(match.1)
            let items = block.split(separator: "\n").map { line in
                let content = line.replacing(#/^\s*[-+]\s+/#) { _ in "" }
                return "<li>\(content)</li>"
            }
            return "<ul>\(items.joined())</ul>"
        }
        return result
    }

    private static func renderOrderedList(_ md: String) -> String {
        var result = md
        let listRegex = #/(?m)((^\s*\d+\.\s+.+$\n)+)/#
        result = result.replacing(listRegex) { match in
            let block = String(match.1)
            let items = block.split(separator: "\n").map { line in
                let content = line.replacing(#/^\s*\d+\.\s+/#) { _ in "" }
                return "<li>\(content)</li>"
            }
            return "<ol>\(items.joined())</ol>"
        }
        return result
    }

    private static func renderParagraphs(_ md: String) -> String {
        // 将剩余连续非空行包裹为 <p>
        let paraRegex = #/(?m)((^[^\n<].*$\n?)+)/#
        return md.replacing(paraRegex) { match in
            let block = String(match.1).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !block.isEmpty,
                  !block.hasPrefix("<"),
                  !block.contains("</table>") else { return String(match.1) }
            return "<p>\(block.replacingOccurrences(of: "\n", with: "<br>"))</p>"
        }
    }

    private static func detectLanguage(_ code: String) -> String? {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.contains("class ") || trimmed.contains("public ") || trimmed.contains("private ") {
            return "java"
        }
        if trimmed.contains("func ") || trimmed.contains("var ") || trimmed.contains("let ") {
            return "swift"
        }
        if trimmed.contains("SELECT ") || trimmed.contains("CREATE TABLE") {
            return "sql"
        }
        return nil
    }

    private static func escapeHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
