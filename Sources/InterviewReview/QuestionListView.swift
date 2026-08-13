import SwiftUI

/// 题目列表视图（统计卡片点击后进入）
/// 支持筛选：全部 / 已学 / 已掌握，点击题目展开答案
struct QuestionListView: View {
    let title: String
    let questions: [Question]
    let onBack: () -> Void

    @State private var expandedId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            if questions.isEmpty {
                VStack(spacing: 10) {
                    Text("📭")
                        .font(.largeTitle)
                    Text("暂无题目")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(questions) { q in
                            questionCard(q)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack {
            Button {
                onBack()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 13, weight: .semibold))
            }
            .buttonStyle(.plain)

            Text(title)
                .font(.title3.bold())
            Spacer()
            Text("\(questions.count) 题")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func questionCard(_ q: Question) -> some View {
        let isExpanded = expandedId == q.id

        return VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    expandedId = isExpanded ? nil : q.id
                }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Text(q.category)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.1))
                        .clipShape(Capsule())

                    Text(q.question)
                        .font(.system(size: 12, weight: .medium))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)

                    Spacer(minLength: 8)

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                Divider()
                // 不限制高度：卡片自然伸展，外层 ScrollView 统一滚动
                AnswerView(markdown: q.answer)
            }
        }
        .padding(10)
        .background(Color.primary.opacity(0.04))
        .cornerRadius(10)
    }
}
