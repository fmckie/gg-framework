// iPhone: starting Kleio's Live Activities and collecting their push tokens.
// Driven from Rust (src-tauri/src/kleio/live.rs) through the C functions below.
//
// The app starts an activity when you send a message; the Kleio host keeps it
// current by push. Every token iOS issues goes back to Rust as one JSON line,
// and Rust registers it with the host:
//   {"type":"token","token":"<hex>","sessionId":…,"groupId":…}  an activity's
//     update token: how the host updates and ends that activity;
//   {"type":"startToken","token":"<hex>"}  the app's push-to-start token: how
//     the host starts an activity when an agent needs you and none is showing.

import ActivityKit
import Foundation

/// Rust's receiver for token reports; called on any thread.
public typealias KleioLiveReport = @convention(c) (UnsafePointer<CChar>) -> Void

private final class KleioLive: @unchecked Sendable {
  static let shared = KleioLive()

  private let lock = NSLock()
  private var report: KleioLiveReport?
  /// Activities whose token updates are being followed.
  private var followed = Set<String>()

  func begin(reporting report: @escaping KleioLiveReport) {
    let first = lock.withLock { () -> Bool in
      let first = self.report == nil
      self.report = report
      return first
    }
    guard first else { return }
    Task {
      for await token in Activity<KleioActivityAttributes>.pushToStartTokenUpdates {
        self.send(["type": "startToken", "token": hex(token)])
      }
    }
    Task {
      for await activity in Activity<KleioActivityAttributes>.activityUpdates {
        self.follow(activity)
      }
    }
    // Ones from before this launch: the host may have restarted since.
    for activity in Activity<KleioActivityAttributes>.activities {
      follow(activity)
    }
  }

  /// Show an activity for a conversation, unless one is already live: the
  /// host keeps that one current. Leftovers that already ended go first.
  func start(_ request: StartRequest) async {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      NSLog("kleio: Live Activities are turned off for Kleio")
      return
    }
    let mine = Activity<KleioActivityAttributes>.activities.filter {
      $0.attributes.sessionId == request.sessionId && $0.attributes.groupId == request.groupId
    }
    if let live = mine.first(where: { $0.activityState == .active || $0.activityState == .stale }) {
      // Re-send its token: the host may have lost it.
      if let token = live.pushToken { sendToken(token, for: live) }
      return
    }
    // A chat keeps the name its first message gave it.
    let title = request.kind == "chat" ? (mine.first?.attributes.title ?? request.title) : request.title
    for old in mine {
      await old.end(nil, dismissalPolicy: .immediate)
    }
    let attributes = KleioActivityAttributes(
      kind: request.kind,
      title: title,
      sessionId: request.sessionId,
      groupId: request.groupId
    )
    let state = KleioActivityAttributes.ContentState(
      phase: "working",
      line: "Starting…",
      detail: nil,
      startedAt: Date().timeIntervalSince1970,
      endedAt: nil
    )
    do {
      let activity = try Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(30 * 60)),
        pushType: .token
      )
      follow(activity)
    } catch {
      NSLog("kleio: could not start a Live Activity: \(error.localizedDescription)")
    }
  }

  private func follow(_ activity: Activity<KleioActivityAttributes>) {
    let fresh = lock.withLock { followed.insert(activity.id).inserted }
    guard fresh else { return }
    if let token = activity.pushToken { sendToken(token, for: activity) }
    Task {
      for await token in activity.pushTokenUpdates {
        self.sendToken(token, for: activity)
      }
    }
  }

  private func sendToken(_ token: Data, for activity: Activity<KleioActivityAttributes>) {
    var line: [String: String] = ["type": "token", "token": hex(token)]
    if let sessionId = activity.attributes.sessionId { line["sessionId"] = sessionId }
    if let groupId = activity.attributes.groupId { line["groupId"] = groupId }
    send(line)
  }

  private func send(_ line: [String: String]) {
    guard let report = lock.withLock({ self.report }),
      let data = try? JSONSerialization.data(withJSONObject: line, options: [.sortedKeys]),
      let json = String(data: data, encoding: .utf8)
    else { return }
    json.withCString { report($0) }
  }
}

struct StartRequest: Decodable {
  let kind: String
  let title: String
  let sessionId: String?
  let groupId: String?
}

private func hex(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

/// Start following push-to-start and activity tokens. Call once, at launch.
@_cdecl("kleio_live_begin")
public func kleioLiveBegin(_ report: KleioLiveReport) {
  KleioLive.shared.begin(reporting: report)
}

/// Show a Live Activity for a conversation; `json` is a StartRequest.
/// Returns at once; the activity starts in the background.
@_cdecl("kleio_live_start")
public func kleioLiveStart(_ json: UnsafePointer<CChar>) {
  let data = Data(String(cString: json).utf8)
  guard let request = try? JSONDecoder().decode(StartRequest.self, from: data) else {
    NSLog("kleio: bad Live Activity request")
    return
  }
  Task { await KleioLive.shared.start(request) }
}
