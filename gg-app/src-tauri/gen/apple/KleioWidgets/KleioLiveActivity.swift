// Kleio's Live Activity: what an agent is doing, on the lock screen and in the
// Dynamic Island, in Kleio's own look: the column-K on the icon's crimson,
// warm near-black, the Didot wordmark. Plain on purpose: which conversation,
// what's happening now in a few words, and for how long.
//
// When an agent asks you something it turns crimson, shows the question, and
// offers its options as buttons: a tap answers (after Face ID) and opens the
// conversation.
//
// The Kleio host keeps it current by push (packages/kleio-host/src/live-activity.ts).

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Brand

/// Kleio's palette (gg-app/src/kleio/kleio-theme.css).
enum Brand {
  /// The icon's red.
  static let red = Color(red: 0.545, green: 0.082, blue: 0.129)  // #8b1521
  /// Fills behind white labels.
  static let crimson = Color(red: 0.784, green: 0.157, blue: 0.227)  // #c8283a
  /// Text, icons and highlights on near-black.
  static let accent = Color(red: 1.0, green: 0.361, blue: 0.412)  // #ff5c69
  static let background = Color(red: 0.047, green: 0.035, blue: 0.039)  // #0c090a
  static let surface = Color(red: 0.122, green: 0.102, blue: 0.106)  // #1f1a1b
  static let text = Color(red: 0.965, green: 0.945, blue: 0.945)  // #f6f1f1
  static let muted = Color(red: 0.651, green: 0.612, blue: 0.616)  // #a69c9d
  static let done = Color(red: 0.498, green: 0.910, blue: 0.604)  // #7fe89a

  /// The wordmark's serif, as on Kleio's home screen.
  static func wordmark(_ size: CGFloat) -> Font { .custom("Didot", size: size) }
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

  /// The small badge on the tile's corner; none while working.
  var badge: (symbol: String, color: Color)? {
    switch self {
    case .working: return nil
    case .needsYou: return ("hand.raised.fill", .white)
    case .done: return ("checkmark", Brand.done)
    case .failed: return ("exclamationmark", Brand.accent)
    case .stopped: return ("stop.fill", Brand.muted)
    }
  }
}

func kindLabel(_ kind: String) -> String {
  switch kind {
  case "code": return "Code"
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

// MARK: - Pieces

/// The column-K mark (white, from the app icon), tintable.
struct Mark: View {
  let height: CGFloat
  var tint: Color = .white

  var body: some View {
    Image("KleioMark")
      .renderingMode(.template)
      .resizable()
      .aspectRatio(contentMode: .fit)
      .frame(height: height)
      .foregroundStyle(tint)
      .accessibilityLabel("Kleio")
  }
}

/// The app icon in small: the mark on crimson, with a state badge on its corner.
struct BrandTile: View {
  let tone: Tone
  let size: CGFloat

  var body: some View {
    RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
      .fill(
        LinearGradient(
          colors: [Brand.crimson, Brand.red],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
      .overlay(
        RoundedRectangle(cornerRadius: size * 0.27, style: .continuous)
          .strokeBorder(.white.opacity(0.14), lineWidth: 0.5)
      )
      .frame(width: size, height: size)
      .overlay(Mark(height: size * 0.56))
      .overlay(alignment: .bottomTrailing) {
        if let badge = tone.badge {
          Circle()
            .fill(Brand.background)
            .frame(width: size * 0.44, height: size * 0.44)
            .overlay(
              Image(systemName: badge.symbol)
                .font(.system(size: size * 0.2, weight: .heavy))
                .foregroundStyle(badge.color)
            )
            .offset(x: size * 0.14, y: size * 0.14)
            .transition(.scale.combined(with: .opacity))
        }
      }
      .accessibilityHidden(true)
  }
}

/// "KLEIO · GROUP": the wordmark over the conversation's title.
struct Eyebrow: View {
  let kind: String

  var body: some View {
    HStack(spacing: 6) {
      Text("KLEIO")
        .font(Brand.wordmark(11))
        .tracking(2.6)
        .foregroundStyle(Brand.text.opacity(0.7))
      Text("·").foregroundStyle(Brand.muted.opacity(0.6))
      Text(kindLabel(kind).uppercased())
        .font(.system(size: 9.5, weight: .semibold))
        .tracking(1.1)
        .foregroundStyle(Brand.muted)
    }
    .lineLimit(1)
  }
}

/// The live timer while working; how long it took once it ended.
struct Clock: View {
  let state: KleioActivityAttributes.ContentState
  let tone: Tone
  var size: CGFloat = 15

  var body: some View {
    Group {
      if tone.ended {
        Text(tookText(from: state.startedAt, to: state.endedAt ?? state.startedAt))
      } else {
        let start = Date(timeIntervalSince1970: state.startedAt)
        Text(timerInterval: start...start.addingTimeInterval(12 * 3600), countsDown: false)
      }
    }
    .font(.system(size: size, weight: .medium, design: .rounded).monospacedDigit())
    .foregroundStyle(tone.ended ? Brand.muted : Brand.text.opacity(0.85))
    .multilineTextAlignment(.trailing)
    .frame(maxWidth: 70, alignment: .trailing)
  }
}

/// What's happening, with a dot in the state's colour.
struct StatusLine: View {
  let line: String
  let tone: Tone
  let stale: Bool

  var body: some View {
    HStack(spacing: 7) {
      Circle()
        .fill(dot)
        .frame(width: 6, height: 6)
        .shadow(color: dot.opacity(0.7), radius: tone == .working ? 3 : 0)
      Text(stale && !tone.ended ? "No news for a while" : line)
        .font(.system(size: 14, weight: tone == .working ? .regular : .semibold))
        .foregroundStyle(tone == .working || stale ? Brand.muted : Brand.text)
        .lineLimit(1)
        .id(line)
        .transition(.push(from: .bottom).combined(with: .opacity))
    }
  }

  private var dot: Color {
    switch tone {
    case .working: return Brand.accent
    case .needsYou: return .white
    case .done: return Brand.done
    case .failed: return Brand.accent
    case .stopped: return Brand.muted
    }
  }
}

/// The question's options as buttons; each answers right there (after Face ID).
struct Options: View {
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
        Button(intent: intent) { chip(options[i], primary: i == context.state.recommended) }
          .buttonStyle(.plain)
          .accessibilityLabel("Answer \(options[i])")
      }
    }
  }

  private func chip(_ label: String, primary: Bool) -> some View {
    Text(label)
      .font(.system(size: 13, weight: .semibold))
      .foregroundStyle(primary ? Brand.crimson : .white)
      .lineLimit(1)
      .padding(.horizontal, 13)
      .padding(.vertical, 6)
      .background(Capsule().fill(primary ? Color.white : Color.white.opacity(0.16)))
      .overlay(Capsule().strokeBorder(.white.opacity(primary ? 0 : 0.28), lineWidth: 0.75))
  }
}

/// The question, in the crimson "needs you" card's body.
struct Question: View {
  let context: ActivityViewContext<KleioActivityAttributes>

  var body: some View {
    let state = context.state
    let options = state.options ?? []
    VStack(alignment: .leading, spacing: 9) {
      if let q = state.detail, !q.isEmpty {
        Text(q)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.white)
          .lineLimit(options.count > 2 ? 1 : 2)
          .fixedSize(horizontal: false, vertical: true)
      }
      if !options.isEmpty, state.askKey != nil {
        Options(context: context, options: options)
      } else {
        Text("Tap to answer in Kleio")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.white.opacity(0.78))
      }
    }
  }
}

// MARK: - Lock screen

struct LockScreenView: View {
  let context: ActivityViewContext<KleioActivityAttributes>

  var body: some View {
    let state = context.state
    let tone = Tone(state.phase)
    Group {
      if tone == .needsYou {
        needsYou
      } else {
        status(tone)
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
    .background { backdrop(tone) }
    .animation(.smooth(duration: 0.45), value: state)
  }

  private func status(_ tone: Tone) -> some View {
    HStack(alignment: .center, spacing: 13) {
      BrandTile(tone: tone, size: 46)
      VStack(alignment: .leading, spacing: 3) {
        Eyebrow(kind: context.attributes.kind)
        Text(context.attributes.title)
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(Brand.text)
          .lineLimit(1)
        StatusLine(line: context.state.line, tone: tone, stale: context.isStale)
      }
      Spacer(minLength: 6)
      Clock(state: context.state, tone: tone)
    }
  }

  private var needsYou: some View {
    VStack(alignment: .leading, spacing: 11) {
      HStack(spacing: 10) {
        BrandTile(tone: .needsYou, size: 30)
        VStack(alignment: .leading, spacing: 1) {
          Eyebrow(kind: context.attributes.kind)
          Text(context.attributes.title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white.opacity(0.92))
            .lineLimit(1)
        }
        Spacer(minLength: 6)
        Text("Needs you")
          .font(.system(size: 11, weight: .bold))
          .tracking(0.4)
          .foregroundStyle(Brand.crimson)
          .padding(.horizontal, 9)
          .padding(.vertical, 4)
          .background(Capsule().fill(.white))
      }
      Question(context: context)
    }
  }

  /// Near-black with the home screen's crimson wash; all crimson when you're needed.
  @ViewBuilder
  private func backdrop(_ tone: Tone) -> some View {
    if tone == .needsYou {
      LinearGradient(
        colors: [Brand.crimson, Brand.red],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    } else {
      ZStack {
        Brand.background
        RadialGradient(
          colors: [Brand.red.opacity(tone == .working ? 0.55 : 0.32), .clear],
          center: UnitPoint(x: 0.06, y: 0.5),
          startRadius: 0,
          endRadius: 190
        )
      }
    }
  }
}

// MARK: - Widget

struct KleioLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: KleioActivityAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Brand.background)
        .activitySystemActionForegroundColor(Brand.text)
        .widgetURL(context.attributes.openURL)
    } dynamicIsland: { context in
      let state = context.state
      let tone = Tone(state.phase)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          BrandTile(tone: tone, size: 40)
            .padding(.leading, 2)
            .padding(.top, 2)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if tone == .needsYou {
            Text("Needs you")
              .font(.system(size: 11, weight: .bold))
              .foregroundStyle(.white)
              .padding(.horizontal, 9)
              .padding(.vertical, 4)
              .background(Capsule().fill(Brand.crimson))
              .padding(.top, 4)
          } else {
            Clock(state: state, tone: tone, size: 16)
              .padding(.top, 4)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Eyebrow(kind: context.attributes.kind)
            Text(context.attributes.title)
              .font(.system(size: 16, weight: .semibold))
              .foregroundStyle(Brand.text)
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Group {
            if tone == .needsYou {
              Question(context: context)
            } else {
              StatusLine(line: state.line, tone: tone, stale: context.isStale)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, 6)
        }
      } compactLeading: {
        Mark(height: 15, tint: tone == .needsYou ? Brand.accent : .white)
          .padding(.leading, 2)
      } compactTrailing: {
        compactTrailing(state: state, tone: tone)
      } minimal: {
        Mark(height: 14, tint: tone == .needsYou ? Brand.accent : .white)
      }
      .keylineTint(Brand.accent)
      .contentMargins(.all, 14, for: .expanded)
      .widgetURL(context.attributes.openURL)
    }
  }

  @ViewBuilder
  private func compactTrailing(
    state: KleioActivityAttributes.ContentState,
    tone: Tone
  ) -> some View {
    switch tone {
    case .needsYou:
      Image(systemName: "hand.raised.fill")
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(Brand.accent)
    case .working:
      let start = Date(timeIntervalSince1970: state.startedAt)
      Text(timerInterval: start...start.addingTimeInterval(12 * 3600), countsDown: false)
        .font(.system(size: 13, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(Brand.accent)
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: 46)
    default:
      if let badge = tone.badge {
        Image(systemName: badge.symbol)
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(badge.color)
      }
    }
  }
}
