import SwiftUI
import AppKit

/// App 生命周期：启动时请求通知权限
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NotificationManager.requestPermission()
    }
}

@main
struct InterviewReviewApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var session = ReviewSession()

    var body: some Scene {
        MenuBarExtra("面试复习", systemImage: "book.fill") {
            ReviewView()
                .environmentObject(session)
        }
        .menuBarExtraStyle(.window)
    }
}
