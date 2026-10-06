// The app's side of AnswerQuestionIntent: a Live Activity's option button was
// tapped (iOS runs the intent here, in the background). Rust sends the answer
// to the Kleio host (src/kleio/live.rs `kleio_live_answer`); the host checks
// the activity's one-off key, answers the agent, and pushes "Back to work".

import Foundation

enum KleioAnswer {
  static func send(conversation: String, askId: String, key: String, choice: Int) async {
    let request: [String: Any] = [
      "conversation": conversation, "askId": askId, "key": key, "choice": choice,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: request),
      let json = String(data: data, encoding: .utf8)
    else { return }
    // A blocking network call: off the cooperative pool.
    let status = await withCheckedContinuation { (done: CheckedContinuation<Int32, Never>) in
      DispatchQueue.global(qos: .userInitiated).async {
        done.resume(returning: json.withCString { kleio_live_answer($0) })
      }
    }
    NSLog("kleio: answered \(askId) from the lock screen → \(status)")
  }
}
