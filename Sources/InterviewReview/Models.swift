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

// MARK: - 复习会话

@MainActor
final class ReviewSession: ObservableObject {
    @Published var currentQuestion: Question?
    @Published var showAnswer = false
    @Published var index = 0
    @Published var sessionActive = false
    @Published var sessionQuestions: [Question] = []
    @Published var clearedCount = 0

    var progress: String {
        "\(index + 1)/\(sessionQuestions.count)"
    }

    func startSession(bank: [Question], count: Int = 5) {
        sessionQuestions = Array(bank.shuffled().prefix(min(count, bank.count)))
        index = 0
        clearedCount = 0
        sessionActive = true
        showAnswer = false
        currentQuestion = sessionQuestions.first
    }

    /// 点击"清楚" → 下一题
    func markClear() {
        clearedCount += 1
        advance()
    }

    /// 点击"不清楚" → 显示答案
    func markUnclear() {
        showAnswer = true
    }

    /// 看完答案 → 下一题
    func advance() {
        index += 1
        if index < sessionQuestions.count {
            currentQuestion = sessionQuestions[index]
            showAnswer = false
        } else {
            // 一轮完成
            sessionActive = false
            currentQuestion = nil
            showAnswer = false
        }
    }
}
