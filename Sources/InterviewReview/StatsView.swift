import SwiftUI

/// 学习统计视图
struct StatsView: View {
    let stats: Stats
    let wrongEntries: [WrongEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("📊 学习统计")
                .font(.title3.bold())

            // 四个核心指标
            HStack(spacing: 10) {
                metricCard("题库", stats.total, "books.vertical.fill", .blue)
                metricCard("已学", stats.reviewed, "checkmark.circle.fill", .green)
                metricCard("错题", stats.wrong, "xmark.circle.fill", .red)
                metricCard("已掌握", stats.mastered, "star.fill", .orange)
            }

            // 总进度条
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("总进度")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(progressPercent)%")
                        .font(.caption.bold())
                }
                ProgressView(value: Double(stats.reviewed), total: Double(max(stats.total, 1)))
                    .tint(.green)
            }

            // 错题 TOP 5
            if !wrongEntries.isEmpty {
                Divider()
                Text("错题 TOP 5")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)

                ForEach(wrongEntries.prefix(5)) { entry in
                    HStack(spacing: 8) {
                        Text("×\(entry.unclearCount)")
                            .font(.caption2.bold())
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Color.red)
                            .clipShape(Capsule())
                        Text(entry.question.question)
                            .font(.caption)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var progressPercent: Int {
        guard stats.total > 0 else { return 0 }
        return stats.reviewed * 100 / stats.total
    }

    private func metricCard(_ title: String, _ value: Int, _ icon: String, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundStyle(color)
            Text("\(value)")
                .font(.system(size: 16, weight: .bold))
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color.primary.opacity(0.04))
        .cornerRadius(8)
    }
}
