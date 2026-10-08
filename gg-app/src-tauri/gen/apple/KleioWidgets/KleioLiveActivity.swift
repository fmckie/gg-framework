// Kleio's Live Activity: what an agent is doing, on the lock screen and in the
// Dynamic Island. Kleio's crimson: the app icon's tile and a red glow while it
// works, the whole card crimson when it needs you, a green ✓ or red ✕ on the
// tile once it ends.
//
// The step trail: which step the run is on (tool calls of one kind in a row
// count once), the step it's doing under the last one it finished, and once it
// ends, a dot per step (the last one red where it couldn't finish).
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

/// Kleio's palette (gg-app/src/kleio/kleio-theme.css).
enum Brand {
  /// The icon's red.
  static let red = Color(red: 0.545, green: 0.082, blue: 0.129)  // #8b1521
  /// Fills behind white labels.
  static let crimson = Color(red: 0.784, green: 0.157, blue: 0.227)  // #c8283a
  /// Text, icons and highlights on near-black.
  static let accent = Color(red: 1.0, green: 0.361, blue: 0.412)  // #ff5c69
  static let background = Color(red: 0.047, green: 0.035, blue: 0.039)  // #0c090a
  static let text = Color(red: 0.965, green: 0.945, blue: 0.945)  // #f6f1f1
  static let muted = Color(red: 0.651, green: 0.612, blue: 0.616)  // #a69c9d
  /// How it ended: a green ✓, a red ✕.
  static let done = Color(red: 0.204, green: 0.780, blue: 0.349)  // #34c759
  static let failed = Color(red: 1.0, green: 0.271, blue: 0.227)  // #ff453a
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

  /// How it ended, on the tile's corner and in the island; none before.
  var badge: (symbol: String, color: Color)? {
    switch self {
    case .working, .needsYou: return nil
    case .done: return ("checkmark", Brand.done)
    case .failed: return ("xmark", Brand.failed)
    case .stopped: return ("stop.fill", Brand.muted)
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

/// "1 step", "3 steps".
func stepsText(_ n: Int) -> String { n == 1 ? "1 step" : "\(n) steps" }

/// The most dots an ended run shows; its line says the exact count.
let dotsMax = 8

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

  /// Out of date: nothing has come from the host for a while (only before the end).
  var quiet: Bool { stale && !tone.ended }

  /// Asking right now: the crimson card.
  var asking: Bool { tone == .needsYou && !quiet }

  /// The tile's look: working's while out of date.
  var tileTone: Tone { quiet ? .working : tone }

  /// Which step the run is on (1 and up), when the host counts them.
  var step: Int? {
    guard let s = state.step, s > 0 else { return nil }
    return s
  }

  /// The last step it finished, while it works.
  var previous: String? {
    guard tone == .working, !quiet, let p = state.prevLine, !p.isEmpty else { return nil }
    return p
  }

  /// How it ended, in a line: "3 steps · <the result>", "Couldn't finish at step 3".
  var endedLine: String {
    switch tone {
    case .done:
      let result = state.summary.flatMap { $0.isEmpty ? nil : $0 }
      guard let n = step else { return result ?? "Finished in \(took)" }
      return result.map { "\(stepsText(n)) · \($0)" } ?? "Finished · \(stepsText(n))"
    case .failed:
      return step.map { "Couldn't finish at step \($0)" } ?? "Couldn't finish · \(took)"
    case .stopped:
      return step.map { "Stopped at step \($0)" } ?? "Stopped · \(took)"
    case .working, .needsYou:
      return ""
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

  /// One spoken sentence: "recipe-app, Kleio Coder, working, step 4, running the tests".
  var accessibilityLabel: String {
    var parts = [title, context, tone.label.lowercased()]
    if quiet {
      parts.append("not updating")
    } else if tone == .working {
      if let n = step { parts.append("step \(n)") }
      parts.append(state.line.lowercased())
      if let p = previous { parts.append("last: \(p.lowercased())") }
    }
    if let q = question { parts.append(q) }
    if tone.ended {
      if let n = step { parts.append(tone == .done ? stepsText(n) : "at step \(n)") }
      if tone == .done, let s = state.summary, !s.isEmpty { parts.append(s) }
      parts.append("took \(took)")
    }
    return parts.joined(separator: ", ")
  }
}

// MARK: - Pieces

/// The column-K mark alone.
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

/// The app icon in small: the mark on crimson, with how it ended on its corner.
/// White with a crimson mark on the crimson "needs you" card.
struct BrandTile: View {
  let tone: Tone
  var size: CGFloat = 34
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
    ZStack {
      if tone == .needsYou {
        shape.fill(dimmed ? Color.clear : Color.white)
        shape.strokeBorder(Color.white.opacity(dimmed ? 0.6 : 0), lineWidth: 1)
      } else if dimmed {
        shape.strokeBorder(Brand.muted.opacity(0.6), lineWidth: 1)
      } else {
        shape.fill(
          LinearGradient(
            colors: [Brand.crimson, Brand.red],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
        )
        shape.strokeBorder(Color.white.opacity(0.14), lineWidth: 0.5)
      }
      MarkGlyph(height: size * 0.56)
        .foregroundStyle(markColor)
    }
    .frame(width: size, height: size)
    .overlay(alignment: .bottomTrailing) {
      if let badge = tone.badge {
        Circle()
          .fill(Brand.background)
          .frame(width: size * 0.46, height: size * 0.46)
          .overlay(
            Image(systemName: badge.symbol)
              .font(.system(size: size * 0.22, weight: .heavy))
              .foregroundStyle(dimmed ? Brand.muted : badge.color)
          )
          .offset(x: size * 0.16, y: size * 0.16)
          .transition(.scale.combined(with: .opacity))
      }
    }
    .accessibilityHidden(true)
  }

  private var markColor: Color {
    if dimmed { return tone == .needsYou ? .white : Brand.muted }
    return tone == .needsYou ? Brand.crimson : .white
  }
}

/// The live timer while it works; how long it took once it ended.
struct Clock: View {
  let model: LiveModel
  var size: CGFloat = 15
  var width: CGFloat = 64

  var body: some View {
    Group {
      if model.tone.ended {
        Text(model.took)
      } else {
        Text(
          timerInterval: model.startDate...model.startDate.addingTimeInterval(12 * 3600),
          countsDown: false
        )
      }
    }
    .font(.system(size: size, weight: .medium, design: .rounded).monospacedDigit())
    .foregroundStyle(model.tone.ended ? Brand.muted : Brand.text.opacity(0.85))
    .multilineTextAlignment(.trailing)
    .frame(width: width, alignment: .trailing)
  }
}

/// "Needs you": white on the crimson card, crimson in the black island.
struct NeedsYouPill: View {
  var onCrimson = true
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let filled = !dimmed
    Text("Needs you")
      .font(.system(size: 11, weight: .bold))
      .tracking(0.4)
      .foregroundStyle(onCrimson && filled ? Brand.crimson : Color.white)
      .padding(.horizontal, 9)
      .padding(.vertical, 4)
      .background(
        Capsule().fill(filled ? (onCrimson ? Color.white : Brand.crimson) : Color.clear)
      )
      .overlay(Capsule().strokeBorder(Color.white.opacity(filled ? 0 : 0.5), lineWidth: 0.75))
      .fixedSize()
  }
}

/// The conversation's kind, with the step it's on while it runs: "Kleio Coder · Step 4".
struct ContextLine: View {
  let model: LiveModel
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let quiet = model.asking ? Color.white.opacity(0.8) : Brand.muted
    HStack(spacing: 0) {
      Text(model.context)
        .foregroundStyle(quiet)
      if let n = model.step, !model.tone.ended {
        Text(" · Step \(n)")
          .foregroundStyle(model.tone == .working && !model.quiet && !dimmed ? Brand.accent : quiet)
          .fixedSize()
          .layoutPriority(1)
      }
    }
    .font(.caption)
    .lineLimit(1)
  }
}

/// Title over the context line.
struct TitleBlock: View {
  let model: LiveModel
  var titleSize: CGFloat = 17

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(model.title)
        .font(.system(size: titleSize, weight: .semibold))
        .foregroundStyle(model.asking ? Color.white : Brand.text)
        .lineLimit(1)
      ContextLine(model: model)
    }
  }
}

/// What it's doing, under the last step it finished.
struct StepLines: View {
  let model: LiveModel
  var small = false
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    VStack(alignment: .leading, spacing: small ? 2 : 3) {
      if let prev = model.previous {
        HStack(spacing: 7) {
          Image(systemName: "checkmark")
            .font(.system(size: small ? 8 : 9, weight: .bold))
            .frame(width: 10)
          Text(prev)
            .lineLimit(1)
        }
        .font(small ? .caption : .footnote)
        .foregroundStyle(Brand.muted)
      }
      HStack(spacing: 7) {
        Circle()
          .fill(dimmed ? Brand.muted : Brand.accent)
          .frame(width: 7, height: 7)
          .frame(width: 10)
        Text(model.state.line)
          .lineLimit(1)
          .id(model.state.line)
          .transition(.push(from: .bottom).combined(with: .opacity))
      }
      .font(small ? .footnote : .subheadline)
      .foregroundStyle(Brand.text)
    }
  }
}

/// A dot per step of an ended run: green, the last one red where it couldn't
/// finish, grey where it was stopped.
struct StepDots: View {
  let count: Int
  let tone: Tone
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let shown = min(count, dotsMax)
    HStack(spacing: 4) {
      ForEach(0..<shown, id: \.self) { i in
        Circle()
          .fill(color(last: i == shown - 1))
          .frame(width: 7, height: 7)
      }
    }
  }

  private func color(last: Bool) -> Color {
    if dimmed { return Brand.muted }
    if last && tone == .failed { return Brand.failed }
    if last && tone == .stopped { return Brand.muted }
    return Brand.done
  }
}

/// How it ended: the dots, then the line.
struct EndedLine: View {
  let model: LiveModel
  var small = false

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      if let n = model.step { StepDots(count: n, tone: model.tone) }
      Text(model.endedLine)
        .font(small ? .footnote : .subheadline)
        .foregroundStyle(Brand.text.opacity(0.85))
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// One answer as a capsule: the recommended one white, the rest glass.
struct AnswerChip: View {
  let label: String
  let primary: Bool
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let filled = primary && !dimmed
    Text(label)
      .font(.system(size: 13, weight: .semibold))
      .foregroundStyle(filled ? Brand.crimson : Color.white)
      .lineLimit(1)
      .padding(.horizontal, 13)
      .padding(.vertical, 6)
      .background(Capsule().fill(filled ? Color.white : Color.white.opacity(dimmed ? 0 : 0.16)))
      .overlay(Capsule().strokeBorder(Color.white.opacity(filled ? 0 : 0.28), lineWidth: 0.75))
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

/// The question with its answers, while the agent needs you.
struct QuestionBlock: View {
  let context: ActivityViewContext<KleioActivityAttributes>
  let model: LiveModel

  var body: some View {
    let options = model.options
    VStack(alignment: .leading, spacing: 9) {
      if let q = model.question {
        Text(q)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(Color.white)
          // Kept under the lock screen's 160 pt with two rows of answers.
          .lineLimit(options.count > 2 ? 1 : 2)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityHidden(true)
      }
      if !options.isEmpty {
        Answers(context: context, options: options)
      } else {
        Text("Tap to answer in Kleio")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(Color.white.opacity(0.78))
          .accessibilityHidden(true)
      }
    }
  }
}

/// Row 2 everywhere: the steps, the question, or how it ended.
struct StatusBlock: View {
  let context: ActivityViewContext<KleioActivityAttributes>
  let model: LiveModel
  var small = false

  var body: some View {
    Group {
      if model.quiet {
        Text("Not updating. Open Kleio to refresh.")
          .font(small ? .footnote : .subheadline)
          .foregroundStyle(Brand.muted)
          .lineLimit(2)
          .accessibilityHidden(true)
      } else if model.tone == .needsYou {
        QuestionBlock(context: context, model: model)
      } else if model.tone == .working {
        StepLines(model: model, small: small)
          .accessibilityHidden(true)
      } else {
        EndedLine(model: model, small: small)
          .accessibilityHidden(true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

// MARK: - Lock screen

/// Near-black with the icon's red glow; all crimson while it needs you.
struct Backdrop: View {
  let model: LiveModel
  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    if dimmed {
      Brand.background
    } else if model.asking {
      LinearGradient(
        colors: [Brand.crimson, Brand.red],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    } else {
      ZStack {
        Brand.background
        RadialGradient(
          colors: [Brand.red.opacity(model.tone == .working ? 0.55 : 0.32), .clear],
          center: UnitPoint(x: 0.06, y: 0.5),
          startRadius: 0,
          endRadius: 190
        )
      }
    }
  }
}

struct LockScreenView: View {
  let context: ActivityViewContext<KleioActivityAttributes>

  var body: some View {
    let model = LiveModel(
      attributes: context.attributes, state: context.state, stale: context.isStale)
    VStack(alignment: .leading, spacing: model.asking ? 11 : 9) {
      HStack(alignment: .center, spacing: model.asking ? 10 : 12) {
        BrandTile(tone: model.asking ? .needsYou : model.tileTone, size: model.asking ? 30 : 34)
        TitleBlock(model: model, titleSize: model.asking ? 15 : 17)
        Spacer(minLength: 6)
        if model.asking {
          NeedsYouPill()
        } else {
          Clock(model: model)
        }
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(model.accessibilityLabel)
      StatusBlock(context: context, model: model)
    }
    .padding(.horizontal, 16)
    // A long question with four answers fills the lock screen's 160 pt; a
    // little less padding keeps it inside.
    .padding(.vertical, model.asking ? 12 : 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background { Backdrop(model: model) }
    .animation(.smooth(duration: 0.45), value: context.state)
  }
}

// MARK: - Dynamic Island

/// Compact trailing: the step it's on, the timer before the first, or how it ended.
struct CompactTrailing: View {
  let model: LiveModel

  var body: some View {
    if model.asking {
      Image(systemName: "hand.raised.fill")
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(Brand.accent)
    } else if let badge = model.tone.badge {
      Image(systemName: badge.symbol)
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(badge.color)
    } else if let n = model.step, !model.quiet {
      Text("Step \(n)")
        .font(.system(size: 13, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(Color.white)
        .contentTransition(.numericText())
        .lineLimit(1)
        .fixedSize()
    } else {
      Text(
        timerInterval: model.startDate...model.startDate.addingTimeInterval(12 * 3600),
        countsDown: false
      )
      .font(.system(size: 13, weight: .semibold, design: .rounded).monospacedDigit())
      .foregroundStyle(Brand.accent)
      .multilineTextAlignment(.trailing)
      .frame(maxWidth: 46)
    }
  }
}

/// Minimal (beside another app's activity): the mark, or what needs you or how it ended.
struct MinimalView: View {
  let model: LiveModel

  var body: some View {
    if model.asking {
      Image(systemName: "hand.raised.fill")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(Brand.accent)
    } else if let badge = model.tone.badge {
      Image(systemName: badge.symbol)
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(badge.color)
    } else {
      MarkGlyph(height: 14).foregroundStyle(Color.white)
    }
  }
}

// MARK: - Widget

struct KleioLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: KleioActivityAttributes.self) { context in
      LockScreenView(context: context)
        .environment(\.colorScheme, .dark)
        .activityBackgroundTint(Brand.background)
        .activitySystemActionForegroundColor(Brand.text)
        .widgetURL(context.attributes.openURL)
    } dynamicIsland: { context in
      let model = LiveModel(
        attributes: context.attributes, state: context.state, stale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 10) {
            BrandTile(tone: model.tileTone, size: 32)
            TitleBlock(model: model, titleSize: 15)
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(model.accessibilityLabel)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Group {
            if model.asking {
              NeedsYouPill(onCrimson: false)
            } else {
              Clock(model: model, size: 14, width: 58)
            }
          }
          .frame(maxHeight: .infinity, alignment: .center)
          .accessibilityHidden(true)
        }
        DynamicIslandExpandedRegion(.bottom) {
          StatusBlock(context: context, model: model, small: true)
            .padding(.top, 4)
        }
      } compactLeading: {
        MarkGlyph(height: 15)
          .foregroundStyle(model.asking ? Brand.accent : Color.white)
          .padding(.leading, 2)
          .accessibilityLabel(model.accessibilityLabel)
      } compactTrailing: {
        CompactTrailing(model: model)
          .accessibilityHidden(true)
      } minimal: {
        MinimalView(model: model)
          .accessibilityLabel(model.accessibilityLabel)
      }
      .keylineTint(Brand.accent)
      .contentMargins(.all, 14, for: .expanded)
      .widgetURL(context.attributes.openURL)
    }
  }
}
