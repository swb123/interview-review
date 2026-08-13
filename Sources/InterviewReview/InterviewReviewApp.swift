import SwiftUI

@main
struct InterviewReviewApp: App {
    @StateObject private var session = ReviewSession()

    var body: some Scene {
        MenuBarExtra("面试复习", systemImage: "book.fill") {
            ReviewView()
                .environmentObject(session)
        }
        .menuBarExtraStyle(.window)
    }
}
