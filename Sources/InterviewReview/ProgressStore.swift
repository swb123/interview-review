import Foundation

/// 学习进度持久化：~/interview-review/progress.json
struct ProgressStore {
    private var url: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("interview-review/progress.json")
    }

    private var cache: [String: ProgressEntry]?

    /// 加载全部进度（带内存缓存）
    mutating func load() -> [String: ProgressEntry] {
        if let cache { return cache }

        guard let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([ProgressEntry].self, from: data) else {
            cache = [:]
            return [:]
        }

        cache = Dictionary(uniqueKeysWithValues: entries.map { ($0.questionId, $0) })
        return cache!
    }

    /// 更新单题进度并落盘
    mutating func update(questionId: String, _ transform: (ProgressEntry?) -> ProgressEntry) {
        var entries = load()
        entries[questionId] = transform(entries[questionId])
        save(entries)
    }

    private mutating func save(_ entries: [String: ProgressEntry]) {
        cache = entries
        let array = entries.values.sorted { $0.questionId < $1.questionId }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(array) {
            try? data.write(to: url, options: .atomic)
        }
    }
}
