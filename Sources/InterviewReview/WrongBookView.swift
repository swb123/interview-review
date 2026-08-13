import SwiftUI

/// 错题本视图
struct WrongBookView: View {
    let entries: [WrongEntry]
    @State private var expandedId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            if entries.isEmpty {
                VStack(spacing: 10) {
                    Text("🎉")
                        .font(.largeTitle)
                    Text("暂无错题")
                        .font(.body)
                        .foregroundStyle(.secondary)
                    Text("点「不清楚」的题会自动收录到这里")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(entries) { entry in
                            wrongCard(entry)
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(width: 520, height: 420)
    }

    private var header: some View {
        HStack {
            Text("📕 错题本")
                .font(.title3.bold())
            Spacer()
            Text("\(entries.count) 道")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func wrongCard(_ entry: WrongEntry) -> some View {
        let isExpanded = expandedId == entry.id

        return VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    expandedId = isExpanded ? nil : entry.id
                }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    // 答错次数徽章
                    Text("×\(entry.unclearCount)")
                        .font(.caption2.bold())
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red)
                        .clipShape(Capsule())

                    Text(entry.question.question)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                Divider()
                AnswerView(markdown: entry.question.answer)
                    .frame(maxHeight: 260)
            }
        }
        .padding(10)
        .background(Color.primary.opacity(0.04))
        .cornerRadius(10)
    }
}
