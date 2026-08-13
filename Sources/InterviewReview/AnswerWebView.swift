import SwiftUI
import WebKit

/// 答案渲染视图：WKWebView + 内联 CSS，支持代码块/表格/列表/粗体
struct AnswerWebView: NSViewRepresentable {
    let markdown: String

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let bodyHTML = MarkdownRenderer.renderHTML(markdown)
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, "PingFang SC", sans-serif;
            font-size: 13px;
            line-height: 1.6;
            margin: 0;
            padding: 4px 8px;
            color: #333;
        }
        @media (prefers-color-scheme: dark) {
            body { color: #ddd; }
        }
        h1, h2, h3, h4 { margin: 10px 0 6px; line-height: 1.3; }
        h1 { font-size: 18px; } h2 { font-size: 16px; }
        h3 { font-size: 14px; } h4 { font-size: 13px; }
        p { margin: 6px 0; }
        strong { font-weight: 600; }

        /* 代码块 */
        .code-block {
            position: relative;
            margin: 8px 0;
            border-radius: 8px;
            background: #1e1e1e;
            overflow: hidden;
        }
        .code-block pre {
            margin: 0;
            padding: 12px;
            overflow-x: auto;
            font-family: "SF Mono", Menlo, monospace;
            font-size: 12px;
            line-height: 1.5;
            color: #d4d4d4;
        }
        .code-lang {
            position: absolute;
            top: 6px; right: 10px;
            font-size: 10px;
            color: #888;
            font-family: "SF Mono", Menlo, monospace;
        }

        /* 行内代码 */
        code {
            font-family: "SF Mono", Menlo, monospace;
            font-size: 12px;
            background: rgba(128, 128, 128, 0.15);
            padding: 1px 5px;
            border-radius: 4px;
        }

        /* 表格 */
        table {
            border-collapse: collapse;
            margin: 8px 0;
            width: 100%;
            font-size: 12px;
        }
        th, td {
            border: 1px solid rgba(128, 128, 128, 0.3);
            padding: 6px 8px;
            text-align: left;
        }
        th {
            background: rgba(128, 128, 128, 0.12);
            font-weight: 600;
        }

        /* 列表 */
        ul, ol { margin: 6px 0; padding-left: 22px; }
        li { margin: 3px 0; }

        /* 引用块 */
        blockquote {
            margin: 8px 0;
            padding: 6px 12px;
            border-left: 3px solid rgba(128, 128, 128, 0.4);
            background: rgba(128, 128, 128, 0.08);
            border-radius: 0 6px 6px 0;
        }

        hr { border: none; border-top: 1px solid rgba(128, 128, 128, 0.25); margin: 10px 0; }
        a { color: #007aff; text-decoration: none; }
        </style>
        </head>
        <body>\(bodyHTML)</body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}
