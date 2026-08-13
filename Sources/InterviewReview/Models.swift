import Foundation
import SwiftUI

// MARK: - 数据模型

struct Question: Codable, Identifiable, Hashable {
    let id: String
    let category: String
    let number: String
    let question: String
    let answer: String
}

struct QuestionBank: Codable {
    let version: String
    let total: Int
    let questions: [Question]
}

/// 每题的学习进度（间隔重复）
struct ProgressEntry: Codable {
    let questionId: String
    var consecutiveClear: Int   // 连续答对次数
    var intervalDays: Int       // 当前复习间隔（天）
    var nextReviewDate: Date    // 下次复习日期
    var clearCount: Int         // 累计答对
    var unclearCount: Int       // 累计答错
    var lastReviewed: Date?     // 最近一次复习时间
}

// MARK: - 复习会话（V2.1 间隔重复调度）

@MainActor
final class ReviewSession: ObservableObject {
    @Published var currentQuestion: Question?
    @Published var showAnswer = false
    @Published var index = 0
    @Published var sessionActive = false
    @Published var sessionQuestions: [Question] = []
    @Published var clearedCount = 0

    // 今日队列统计
    @Published var newCount = 0      // 今日新题数
    @Published var dueCount = 0      // 今日到期复习数

    /// 每日新题配额
    static let dailyNewQuota = 5

    private var store = ProgressStore()

    var progress: String {
        "\(index + 1)/\(sessionQuestions.count)"
    }

    // MARK: 今日队列构建

    /// 构建今日复习队列：新题（每日配额）+ 到期复习题
    func loadTodayQueue(bank: [Question]) {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let progressMap = store.load()

        // 到期题（nextReviewDate <= 今天）
        let dueIds = Set(progressMap.values
            .filter { calendar.startOfDay(for: $0.nextReviewDate) <= today }
            .map(\.questionId))

        // 新题池（从未学过的）
        let newPool = bank.filter { progressMap[$0.id] == nil }
        let quota = min(Self.dailyNewQuota, newPool.count)
        let newIntro = Array(newPool.shuffled().prefix(quota))

        // 队列 = 新题在前 + 到期题在后
        sessionQuestions = newIntro + bank.filter { dueIds.contains($0.id) }
        newCount = newIntro.count
        dueCount = sessionQuestions.count - newIntro.count

        index = 0
        clearedCount = 0
        sessionActive = !sessionQuestions.isEmpty
        showAnswer = false
        currentQuestion = sessionQuestions.first
    }

    // MARK: 答题处理

    /// 清楚 → 间隔递增 → 下一题
    func markClear() {
        guard let q = currentQuestion else { return }
        clearedCount += 1
        store.update(questionId: q.id) { entry in
            var e = entry ?? ProgressEntry(questionId: q.id,
                                           consecutiveClear: 0,
                                           intervalDays: 0,
                                           nextReviewDate: Date(),
                                           clearCount: 0,
                                           unclearCount: 0,
                                           lastReviewed: nil)
            e.clearCount += 1
            e.consecutiveClear += 1
            e.intervalDays = Self.nextInterval(e.consecutiveClear)
            e.nextReviewDate = calendar.date(byAdding: .day, value: e.intervalDays, to: Date()) ?? Date()
            e.lastReviewed = Date()
            return e
        }
        advance()
    }

    /// 不清楚 → 显示答案，明天再来
    func markUnclear() {
        guard let q = currentQuestion else { return }
        store.update(questionId: q.id) { entry in
            var e = entry ?? ProgressEntry(questionId: q.id,
                                           consecutiveClear: 0,
                                           intervalDays: 0,
                                           nextReviewDate: Date(),
                                           clearCount: 0,
                                           unclearCount: 0,
                                           lastReviewed: nil)
            e.unclearCount += 1
            e.consecutiveClear = 0
            e.intervalDays = 1
            e.nextReviewDate = calendar.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            e.lastReviewed = Date()
            return e
        }
        showAnswer = true
    }

    /// 看完答案 → 下一题
    func advance() {
        index += 1
        if index < sessionQuestions.count {
            currentQuestion = sessionQuestions[index]
            showAnswer = false
        } else {
            sessionActive = false
            currentQuestion = nil
            showAnswer = false
        }
    }

    // MARK: 间隔表

    /// 连续答对 N 次后的下次间隔
    /// 1次→1天, 2次→2天, 3次→4天, 4次→7天, 5次→15天, 6次+→30天
    static func nextInterval(_ consecutiveClear: Int) -> Int {
        let intervals = [1, 2, 4, 7, 15, 30]
        let idx = max(0, consecutiveClear - 1)
        return intervals[min(idx, intervals.count - 1)]
    }

    private var calendar: Calendar { Calendar.current }

    // MARK: 错题本 & 统计

    /// 错题列表：答错过的题，按答错次数降序
    func loadWrongBook(bank: [Question]) -> [WrongEntry] {
        let progressMap = store.load()
        var entries: [WrongEntry] = []

        for q in bank {
            if let p = progressMap[q.id], p.unclearCount > 0 {
                entries.append(WrongEntry(
                    question: q,
                    unclearCount: p.unclearCount,
                    clearCount: p.clearCount,
                    lastReviewed: p.lastReviewed
                ))
            }
        }

        return entries.sorted { $0.unclearCount > $1.unclearCount }
    }

    /// 学习统计
    func loadStats(bank: [Question]) -> Stats {
        let progressMap = store.load()
        let reviewed = progressMap.count
        let wrong = progressMap.values.filter { $0.unclearCount > 0 }.count
        let mastered = progressMap.values.filter { $0.consecutiveClear >= 5 }.count
        let total = bank.count
        return Stats(total: total,
                     reviewed: reviewed,
                     wrong: wrong,
                     mastered: mastered)
    }
}

/// 错题条目
struct WrongEntry: Identifiable {
    let question: Question
    let unclearCount: Int
    let clearCount: Int
    let lastReviewed: Date?

    var id: String { question.id }
}

/// 学习统计
struct Stats {
    let total: Int        // 题库总数
    let reviewed: Int     // 已学题数
    let wrong: Int        // 错题数
    let mastered: Int     // 已掌握（连续答对5次+）
}
