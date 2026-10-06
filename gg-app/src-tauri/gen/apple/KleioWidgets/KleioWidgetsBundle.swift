// Kleio's widget extension: only the Live Activity, for now.

import SwiftUI
import WidgetKit

@main
struct KleioWidgetsBundle: WidgetBundle {
  var body: some Widget {
    KleioLiveActivity()
  }
}
