// The Live Activity's data, shared by the app (which starts activities and
// hands their push tokens to the Kleio host) and the widget (which draws them).
//
// The host updates activities by push, so these JSON keys are its contract
// (packages/kleio-host/src/live-activity.ts). Times are UNIX seconds kept as
// plain numbers: a Date would decode against Foundation's 2001 epoch.

import ActivityKit
import Foundation

struct KleioActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// working | needsYou | done | failed | stopped. Anything else reads as working.
    var phase: String
    /// What's happening, in a few plain words: "Editing App.tsx".
    var line: String
    /// The question, while the agent needs you.
    var detail: String?
    /// When the current work began (UNIX seconds): the live timer counts from it.
    var startedAt: Double
    /// When the work ended (UNIX seconds).
    var endedAt: Double?
    /// While the agent needs you and the question can be answered with one
    /// tap: which question, the buttons' labels, and the one-off key the
    /// answer carries back (proof the tap came from this activity; see
    /// KleioAnswerIntent.swift).
    var askId: String?
    var askKey: String?
    var options: [String]?
    /// The option the agent recommends (it stands out).
    var recommended: Int?
  }

  /// chat | code | specialist | group
  var kind: String
  /// Which conversation: a project, a specialist or a group's name.
  var title: String
  var sessionId: String?
  var groupId: String?
}

extension KleioActivityAttributes {
  /// Which conversation, as a link's query.
  private var conversation: URLQueryItem? {
    if let groupId { return URLQueryItem(name: "group", value: groupId) }
    if let sessionId { return URLQueryItem(name: "session", value: sessionId) }
    return nil
  }

  /// Opens this conversation (the app routes it like a notification tap).
  var openURL: URL? {
    guard let conversation else { return nil }
    var c = URLComponents()
    c.scheme = "kleio"
    c.host = "open"
    c.queryItems = [conversation]
    return c.url
  }
}
