// The widget's side of AnswerQuestionIntent. The intent is a LiveActivityIntent,
// so iOS always runs it in the app (Sources/gg-app/KleioAnswer.swift); this
// copy only lets the widget build.

enum KleioAnswer {
  static func send(conversation: String, askId: String, key: String, choice: Int) async {}
}
