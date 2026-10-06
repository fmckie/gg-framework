// A Live Activity's option button: answers the agent's question without
// opening Kleio. Compiled into the app and the widget, but as a
// LiveActivityIntent it always runs in the app's process, where
// `KleioAnswer.send` reaches the Kleio host (the widget's copy of
// `KleioAnswer` is never called).

import AppIntents
import Foundation

public struct AnswerQuestionIntent: LiveActivityIntent {
  public static let title: LocalizedStringResource = "Answer Kleio"
  public static let description = IntentDescription("Answers the question an agent asked you.")
  /// A button on the activity, not something for Shortcuts.
  public static let isDiscoverable = false
  /// An answer can tell an agent to go ahead: only with the phone unlocked.
  public static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  /// "s:<sessionId>" or "g:<groupId>".
  @Parameter(title: "Conversation") public var conversation: String
  @Parameter(title: "Question") public var askId: String
  /// The one-off key the host put on this question's activity.
  @Parameter(title: "Key") public var key: String
  @Parameter(title: "Choice") public var choice: Int

  public init() {}

  public init(conversation: String, askId: String, key: String, choice: Int) {
    self.conversation = conversation
    self.askId = askId
    self.key = key
    self.choice = choice
  }

  public func perform() async throws -> some IntentResult {
    await KleioAnswer.send(conversation: conversation, askId: askId, key: key, choice: choice)
    return .result()
  }
}

extension KleioActivityAttributes {
  /// The answer button for option `choice` of the open question, if it has one.
  func answerIntent(_ state: ContentState, choice: Int) -> AnswerQuestionIntent? {
    guard let askId = state.askId, let key = state.askKey else { return nil }
    let conversation: String
    if let groupId { conversation = "g:\(groupId)" }
    else if let sessionId { conversation = "s:\(sessionId)" }
    else { return nil }
    return AnswerQuestionIntent(conversation: conversation, askId: askId, key: key, choice: choice)
  }
}
