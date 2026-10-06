// "Brief me" for Siri and Shortcuts: "Hey Siri, brief me in Kleio" says what
// needs you, what finished and what is still working on the Mac mini. Rust
// fetches the Kleio host's briefing as this iPhone (src/kleio/brief.rs
// `kleio_brief`); Siri reads it in your Siri voice. Read-only.

import AppIntents
import Foundation

struct BriefMeIntent: AppIntent {
  static let title: LocalizedStringResource = "Brief Me"
  static let description = IntentDescription(
    "Hear what needs you, what finished and what is still working on your Mac mini.")
  // The pairing is in the Keychain, which opens only while the phone is
  // unlocked, and a briefing is private: Siri asks to unlock first.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  static let openAppWhenRun = false

  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let words = await KleioBrief.fetch()
    return .result(value: words, dialog: "\(words)")
  }
}

/// The phrases Siri knows without any setup. Each must name the app.
struct KleioShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: BriefMeIntent(),
      phrases: [
        "Brief me in \(.applicationName)",
        "What's happening in \(.applicationName)",
        "What's new in \(.applicationName)",
        "\(.applicationName) briefing",
      ],
      shortTitle: "Brief Me",
      systemImageName: "waveform"
    )
  }
}

enum KleioBrief {
  static func fetch() async -> String {
    // A blocking network call: off the cooperative pool.
    let words = await withCheckedContinuation { (done: CheckedContinuation<String, Never>) in
      DispatchQueue.global(qos: .userInitiated).async {
        guard let raw = kleio_brief() else {
          done.resume(returning: "Sorry, I couldn't get your briefing.")
          return
        }
        let words = String(cString: raw)
        kleio_string_free(raw)
        done.resume(returning: words)
      }
    }
    NSLog("kleio: briefed by Siri (\(words.count) characters)")
    return words
  }
}
