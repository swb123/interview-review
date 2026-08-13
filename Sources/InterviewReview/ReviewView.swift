import SwiftUI

struct ReviewView: View {
    @EnvironmentObject var session: ReviewSession

    enum Tab {
        case review      // 复习
        case wrongBook   // 错题本
        case stats       // 统计
    }

    @State private var tab: Tab = .review

    private var bank: [Question] {
        QuestionLoader.load()
    }

    var body: some View {
        VStack(spacing: 0) {
            tabBar
            Divider()

            Group {
                switch tab {
                case .review:
                    if !session.sessionActive {
                        startView
                    } else if let q = session.currentQuestion {
                        questionView(q)
                    }
                case .wrongBook:
                    WrongBookView(entries: session.loadWrongBook(bank: bank))
                case .stats:
                    StatsView(stats: session.loadStats(bank: bank),
                              wrongEntries: session.loadWrongBook(bank: bank)) { dest in
                        switch dest {
                        case .review: tab = .review
                        case .wrongBook: tab = .wrongBook
                        }
                    }
                }
            }
            .padding(16)
            .frame(width: 520)
        }
    }

    // MARK: - Tab 切换栏

    private var tabBar: some View {
        HStack(spacing: 20) {
            tabButton(.review, "复习", "book.fill")
            tabButton(.wrongBook, "错题本", "xmark.seal.fill")
            tabButton(.stats, "统计", "chart.bar.fill")
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func tabButton(_ target: Tab, _ title: String, _ icon: String) -> some View {
        Button {
            tab = target
        } label: {
            Label(title, systemImage: icon)
                .font(.system(size: 12, weight: tab == target ? .semibold : .regular))
                .foregroundStyle(tab == target ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - 开始页（今日队列概览）

    private var startView: some View {
        VStack(spacing: 14) {
            Text("📚 面试复习")
                .font(.title2.bold())

            Text("题库 \(bank.count) 题 · 间隔重复 · 答题后揭晓答案")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("加载今日队列") {
                session.loadTodayQueue(bank: bank)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            // 今日队列说明
            if session.newCount + session.dueCount > 0 {
                HStack(spacing: 12) {
                    Label("新题 \(session.newCount)", systemImage: "sparkles")
                    Label("复习 \(session.dueCount)", systemImage: "clock.arrow.circlepath")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - 答题页

    private func questionView(_ q: Question) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // 头部：进度 + 分类标签
            HStack {
                Text(session.progress)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(q.category)
                    .font(.caption2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.accentColor.opacity(0.12))
                    .clipShape(Capsule())
            }

            // 题目
            Text(q.question)
                .font(.system(size: 14, weight: .medium))
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            if session.showAnswer {
                answerView(q)
            } else {
                actionButtons
            }
        }
    }

    // MARK: - 答案区

    private func answerView(_ q: Question) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("📖 标准答案")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            ScrollView {
                AnswerView(markdown: q.answer)
            }
            .frame(maxHeight: 380)

            Button("下一题") {
                session.advance()
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - 操作按钮

    private var actionButtons: some View {
        HStack(spacing: 12) {
            Button {
                session.markClear()
            } label: {
                Label("清楚", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)

            Button {
                session.markUnclear()
            } label: {
                Label("不清楚", systemImage: "xmark.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
        }
    }
}
