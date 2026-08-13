import Foundation

enum QuestionLoader {
    /// 优先读取 ~/interview-review/questions.json（可随时更新题库），
    /// 兜底读取 App Bundle 内的 questions.json
    static func load() -> [Question] {
        let fileManager = FileManager.default

        // 1. 用户目录（可热更新题库，不用重新编译）
        let homeURL = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("interview-review/questions.json")
        if let bank = loadBank(from: homeURL) {
            return bank.questions
        }

        // 2. Bundle 内置
        if let url = Bundle.main.url(forResource: "questions", withExtension: "json"),
           let bank = loadBank(from: url) {
            return bank.questions
        }

        return []
    }

    private static func loadBank(from url: URL) -> QuestionBank? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(QuestionBank.self, from: data)
    }
}
