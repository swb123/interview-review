import Foundation
import UserNotifications

/// 系统通知：每日 10:00 / 15:00 / 21:00 提醒复习
enum NotificationManager {

    static let reminderHours = [10, 15, 21]

    /// 请求通知权限（首次启动调用）
    static func requestPermission() {
        // 裸可执行文件（swift run）没有 .app bundle，调用 UserNotifications 会崩溃
        // 打包成 .app 后自动生效
        guard Bundle.main.bundleURL.pathExtension == "app" else { return }

        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            if granted {
                scheduleDaily()
            }
        }
    }

    /// 安排每日定时通知
    static func scheduleDaily() {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()

        let content = UNMutableNotificationContent()
        content.title = "📚 面试复习时间"
        content.body = "今日复习队列待完成，点击菜单栏 📖 图标开始"
        content.sound = .default

        for hour in reminderHours {
            var comps = DateComponents()
            comps.hour = hour
            comps.minute = 0
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
            let request = UNNotificationRequest(
                identifier: "review-reminder-\(hour)",
                content: content,
                trigger: trigger
            )
            center.add(request)
        }
    }
}
