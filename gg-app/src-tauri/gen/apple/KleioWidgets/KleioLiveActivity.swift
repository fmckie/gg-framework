// Kleio's Live Activity: what an agent is doing, on the lock screen and in the
// Dynamic Island. Calm, dark and native: one coral accent for the brand mark
// and for "needs you", system green / red / grey for how it ended, SF Symbols
// and the system font throughout.
//
// When an agent asks you something the question shows with its options as
// buttons: a tap answers (after Face ID) and opens the conversation.
//
// The Kleio host keeps it current by push (packages/kleio-host/src/live-activity.ts).
// The views below are pure SwiftUI over `LiveModel`; KleioLiveActivity wires
// them to ActivityKit.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Look

enum Brand {
  /// Kleio coral, #FF5C69: the brand mark and the needs-you state.
  static let accent = Color(red: 1.0, green: 0.361, blue: 0.412)
  static let background = Color(red: 0.067, green: 0.063, blue: 0.067)  // #111011
}

/// One tone per phase.
enum Tone: Equatable {
  case working, needsYou, done, failed, stopped

  init(_ phase: String) {
    switch phase {
    case "needsYou": self = .needsYou
    case "done": self = .done
    case "failed": self = .failed
    case "stopped": self = .stopped
    default: self = .working
    }
  }

  var ended: Bool { self == .done || self == .failed || self == .stopped }

  /// Coral for Kleio's own states, system colours for how it ended.
  var color: Color {
    switch self {
    case .working: return Brand.accent.opacity(0.7)
    case .needsYou: return Brand.accent
    case .done: return .green
    case .failed: return .red
    case .stopped: return .secondary
    }
  }

  /// The phase's symbol; none while working (the timer stands in).
  var symbol: String? {
    switch self {
    case .working: return nil
    case .needsYou: return "exclamationmark"
    case .done: return "checkmark"
    case .failed: return "xmark"
    case .stopped: return "stop.fill"
    }
  }

  var label: String {
    switch self {
    case .working: return "Working"
    case .needsYou: return "Needs your answer"
    case .done: return "Finished"
    case .failed: return "Couldn't finish"
    case .stopped: return "Stopped"
    }
  }
}

/// The quiet line under the title.
func contextLabel(_ kind: String) -> String {
  switch kind {
  case "code": return "Kleio Coder"
  case "specialist": return "Specialist"
  case "group": return "Group"
  default: return "Chat"
  }
}

/// How long ended work took: "45s", "4m", "1h 5m".
func tookText(from start: Double, to end: Double) -> String {
  let s = max(0, Int(end - start))
  if s < 60 { return "\(s)s" }
  if s < 3600 { return "\(s / 60)m" }
  let m = (s % 3600) / 60
  return m == 0 ? "\(s / 3600)h" : "\(s / 3600)h \(m)m"
}

/// Everything the views draw, worked out once from the attributes and state.
struct LiveModel {
  let title: String
  let context: String
  let tone: Tone
  let state: KleioActivityAttributes.ContentState
  let stale: Bool

  init(
    attributes: KleioActivityAttributes,
    state: KleioActivityAttributes.ContentState,
    stale: Bool
  ) {
    title = attributes.title.isEmpty ? "Kleio" : attributes.title
    context = contextLabel(attributes.kind)
    tone = Tone(state.phase)
    self.state = state
    self.stale = stale
  }

  var startDate: Date { Date(timeIntervalSince1970: state.startedAt) }

  var took: String { tookText(from: state.startedAt, to: state.endedAt ?? state.startedAt) }

  /// "Working · Editing App.tsx", "Finished in 4m", the result, …
  var status: String {
    if stale && !tone.ended { return "Not updating. Open Kleio to refresh." }
    switch tone {
    case .working:
      return "\(tone.label) · \(state.line)"
    case .needsYou:
      return tone.label
    case .done:
      if let s = state.summary, !s.isEmpty { return s }
      return "Finished in \(took)"
    case .failed, .stopped:
      return "\(tone.label) · \(took)"
    }
  }

  var question: String? {
    guard tone == .needsYou, !stale, let q = state.detail, !q.isEmpty else { return nil }
    return q
  }

  var options: [String] {
    guard tone == .needsYou, !stale, state.askKey != nil else { return [] }
    return state.options ?? []
  }

  /// One spoken sentence: "kleio-website, Kleio Coder, working, editing App.tsx".
  var accessibilityLabel: String {
    var parts = [title, context, tone.label.lowercased()]
    if stale && !tone.ended {
      parts.append("not updating")
    } else if tone == .working {
      parts.append(state.line.lowercased())
    }
    if let q = question { parts.append(q) }
    if tone == .done, let s = state.summary, !s.isEmpty { parts.append(s) }
    if tone.ended { parts.append("took \(took)") }
    return parts.joined(separator: ", ")
  }
}

// MARK: - Pieces

/// The column-K mark alone (compact and minimal island).
struct MarkGlyph: View {
  let height: CGFloat

  var body: some View {
    Image("KleioMark")
      .renderingMode(.template)
      .resizable()
      .aspectRatio(contentMode: .fit)
      .frame(height: height)
  }
}

/// The mark in a 28pt rounded tile, tinted by phase.
struct BrandMark: View {
  let tone: Tone
  var size: CGFloat = 28
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let tint: Color = dimmed ? .secondary : (tone == .working ? Brand.accent : tone.color)
    RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
      .fill(dimmed ? Color.clear : tint.opacity(0.18))
      .frame(width: size, height: size)
      .overlay(MarkGlyph(height: size * 0.55).foregroundStyle(tint))
      .accessibilityHidden(true)
  }
}

/// The running timer while working, a phase symbol once it has moved on.
struct Trailing: View {
  let model: LiveModel
  var font: Font = .subheadline
  var timerWidth: CGFloat = 56
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    if let symbol = model.tone.symbol {
      Image(systemName: symbol)
        .font(font.weight(.semibold))
        .foregroundStyle(dimmed ? Color.secondary : model.tone.color)
    } else {
      Text(
        timerInterval: model.startDate...model.startDate.addingTimeInterval(12 * 3600),
        countsDown: false
      )
      .font(font.monospacedDigit())
      .foregroundStyle(.secondary)
      .multilineTextAlignment(.trailing)
      .frame(width: timerWidth, alignment: .trailing)
    }
  }
}

/// Title over the quiet context line.
struct TitleBlock: View {
  let model: LiveModel

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(model.title)
        .font(.headline)
        .foregroundStyle(.primary)
        .lineLimit(1)
      Text(model.context)
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

/// Mark, title and the trailing timer or symbol: row 1 everywhere.
struct HeaderRow: View {
  let model: LiveModel
  var showsTrailing = true

  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      BrandMark(tone: model.tone)
      TitleBlock(model: model)
      Spacer(minLength: 8)
      if showsTrailing { Trailing(model: model) }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(model.accessibilityLabel)
  }
}

/// The status line, or the question while the agent needs you.
struct StatusText: View {
  let model: LiveModel
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    if let q = model.question {
      VStack(alignment: .leading, spacing: 2) {
        Text(model.tone.label)
          .font(.caption.weight(.semibold))
          .foregroundStyle(dimmed ? Color.secondary : Brand.accent)
        Text(q)
          .font(.subheadline)
          .foregroundStyle(.primary)
          .lineLimit(3)
          .fixedSize(horizontal: false, vertical: true)
      }
    } else {
      Text(model.status)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// One answer as a compact capsule.
struct AnswerChip: View {
  let label: String
  let primary: Bool
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let filled = primary && !dimmed
    Text(label)
      .font(.footnote.weight(.semibold))
      .foregroundStyle(filled ? Color.black : Color.primary)
      .lineLimit(1)
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(Capsule().fill(filled ? Brand.accent : Color.white.opacity(dimmed ? 0 : 0.12)))
      .overlay(Capsule().strokeBorder(Color.white.opacity(dimmed ? 0.3 : 0), lineWidth: 0.75))
  }
}

/// The question's options as buttons; each answers right there (after Face ID).
struct Answers: View {
  let context: ActivityViewContext<KleioActivityAttributes>
  let options: [String]

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) { chips(0..<options.count) }
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) { chips(0..<min(2, options.count)) }
        HStack(spacing: 8) { chips(min(2, options.count)..<options.count) }
      }
    }
  }

  @ViewBuilder
  private func chips(_ range: Range<Int>) -> some View {
    ForEach(range, id: \.self) { i in
      if let intent = context.attributes.answerIntent(context.state, choice: i) {
        Button(intent: intent) {
          AnswerChip(label: options[i], primary: i == context.state.recommended)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Answer \(options[i])")
      }
    }
  }
}

/// Row 2: status (or question) with its answers. Shared by the lock screen and
/// the expanded island.
struct StatusBlock: View {
  let context: ActivityViewContext<KleioActivityAttributes>
  let model: LiveModel

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      StatusText(model: model)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.question ?? model.status)
      if !model.options.isEmpty {
        Answers(context: context, options: model.options)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Lock screen

struct LockScreenView: View {
  let context: ActivityViewContext<KleioActivityAttributes>

  var body: some View {
    let model = LiveModel(
      attributes: context.attributes, state: context.state, stale: context.isStale)
    VStack(alignment: .leading, spacing: 10) {
      HeaderRow(model: model)
      // One rail: row 2 lines up under the title, not the mark.
      StatusBlock(context: context, model: model)
        .padding(.leading, 38)
    }
    .padding(16)
    .animation(.smooth(duration: 0.35), value: context.state)
  }
}

// MARK: - Widget

struct KleioLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: KleioActivityAttributes.self) { context in
      LockScreenView(context: context)
        .environment(\.colorScheme, .dark)
        .activityBackgroundTint(Brand.background)
        .activitySystemActionForegroundColor(.white)
        .widgetURL(context.attributes.openURL)
    } dynamicIsland: { context in
      let model = LiveModel(
        attributes: context.attributes, state: context.state, stale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HeaderRow(model: model, showsTrailing: false)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Trailing(model: model)
            .frame(maxHeight: .infinity, alignment: .center)
            .accessibilityHidden(true)
        }
        DynamicIslandExpandedRegion(.bottom) {
          StatusBlock(context: context, model: model)
            .padding(.top, 4)
        }
      } compactLeading: {
        MarkGlyph(height: 14)
          .foregroundStyle(model.tone == .working ? Brand.accent : model.tone.color)
          .accessibilityLabel(model.accessibilityLabel)
      } compactTrailing: {
        Trailing(model: model, font: .caption, timerWidth: 44)
          .accessibilityHidden(true)
      } minimal: {
        Group {
          if let symbol = model.tone.symbol {
            Image(systemName: symbol)
              .font(.caption.weight(.semibold))
              .foregroundStyle(model.tone.color)
          } else {
            MarkGlyph(height: 13).foregroundStyle(Brand.accent)
          }
        }
        .accessibilityLabel(model.accessibilityLabel)
      }
      .keylineTint(Brand.accent)
      .contentMargins(.all, 14, for: .expanded)
      .widgetURL(context.attributes.openURL)
    }
  }
}
