// Screenshots pages in the system WebKit (the engine the Kleio app runs on).
// Usage: snap [--w 1024] [--h 720] [--scale 2] [--wait 1.2] [--onscreen] SRC OUT.png [SRC OUT.png ...]
// SRC is an http(s) URL or a file path under the mockups folder.
// Prints one JSON line per page: overflow, broken images, load errors, external URLs.
import Cocoa
import WebKit

let mockupsRoot = URL(fileURLWithPath: "/Users/wmckie/gg-framework-ui/mockups")
var args = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> Double? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count, let v = Double(args[i + 1]) else { return nil }
  args.removeSubrange(i...(i + 1))
  return v
}
let width = option("--w") ?? 1024
let height = option("--h") ?? 720
let scale = option("--scale") ?? 2
let wait = option("--wait") ?? 1.2
let onscreen = args.contains("--onscreen")
args.removeAll { $0 == "--onscreen" }
guard args.count >= 2, args.count % 2 == 0 else {
  FileHandle.standardError.write("usage: snap [--w W] [--h H] [--scale S] [--wait SEC] [--onscreen] SRC OUT.png ...\n".data(using: .utf8)!)
  exit(64)
}
var jobs: [(String, String)] = stride(from: 0, to: args.count, by: 2).map { (args[$0], args[$0 + 1]) }

let errorHook = """
window.__snapErrors = [];
addEventListener('error', (e) => {
  const t = e.target;
  window.__snapErrors.push(t && t !== window ? `failed to load ${t.tagName.toLowerCase()} ${t.currentSrc || t.src || t.href || ''}` : String(e.message));
}, true);
"""
let probe = """
(() => {
  const d = document.documentElement;
  const vw = innerWidth, vh = innerHeight;
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '') +
    ' "' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 32) + '"';
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== d; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true;
    }
    return false;
  };
  const outside = [], cut = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) && !clipped(el)) outside.push(describe(el));
    const s = getComputedStyle(el);
    if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) cut.push(describe(el));
  }
  const broken = [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src'));
  const external = [...document.querySelectorAll('[src],[href]')].map((e) => e.getAttribute('src') || e.getAttribute('href')).filter((u) => /^(https?:)?\\/\\//.test(u) && !/^https?:\\/\\/(127\\.0\\.0\\.1|localhost)/.test(u));
  return JSON.stringify({ viewport: [vw, vh], scroll: [d.scrollWidth, d.scrollHeight], broken, errors: window.__snapErrors || [], outside: outside.slice(0, 10), cutX: cut.slice(0, 10), external });
})()
"""

final class Runner: NSObject, WKNavigationDelegate {
  let window: NSWindow
  let webView: WKWebView
  var current: (String, String) = ("", "")
  override init() {
    let config = WKWebViewConfiguration()
    config.userContentController.addUserScript(WKUserScript(source: errorHook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    webView = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
    let origin = onscreen ? NSPoint(x: 0, y: 0) : NSPoint(x: -12000, y: -12000)
    window = NSWindow(contentRect: NSRect(origin: origin, size: NSSize(width: width, height: height)), styleMask: [.borderless], backing: .buffered, defer: false)
    super.init()
    webView.navigationDelegate = self
    window.contentView = webView
    window.ignoresMouseEvents = true
    window.setFrameOrigin(origin)
    window.orderFrontRegardless()
  }
  func next() {
    guard !jobs.isEmpty else { exit(0) }
    current = jobs.removeFirst()
    let src = current.0
    if src.hasPrefix("http://") || src.hasPrefix("https://") {
      webView.load(URLRequest(url: URL(string: src)!))
    } else {
      webView.loadFileURL(URL(fileURLWithPath: src), allowingReadAccessTo: mockupsRoot)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [src] in
      if self.current.0 == src { print("{\"src\":\"\(src)\",\"error\":\"timeout\"}"); fflush(stdout); self.next() }
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) { self.capture() }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
  func fail(_ error: Error) {
    print("{\"src\":\"\(current.0)\",\"error\":\"\(error.localizedDescription)\"}"); fflush(stdout); next()
  }
  func capture() {
    let job = current
    webView.evaluateJavaScript(probe) { result, error in
      let report = (result as? String) ?? "{\"probeError\":\"\(String(describing: error))\"}"
      let config = WKSnapshotConfiguration()
      config.rect = CGRect(x: 0, y: 0, width: width, height: height)
      config.snapshotWidth = NSNumber(value: width * scale / self.window.backingScaleFactor)
      self.webView.takeSnapshot(with: config) { image, snapError in
        var saved = false
        if let image = image,
          let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width * scale), pixelsHigh: Int(height * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        {
          rep.size = NSSize(width: width, height: height)
          NSGraphicsContext.saveGraphicsState()
          NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
          NSGraphicsContext.current?.imageInterpolation = .high
          image.draw(in: NSRect(x: 0, y: 0, width: width, height: height))
          NSGraphicsContext.restoreGraphicsState()
          if let png = rep.representation(using: .png, properties: [:]) {
            try? FileManager.default.createDirectory(at: URL(fileURLWithPath: job.1).deletingLastPathComponent(), withIntermediateDirectories: true)
            saved = (try? png.write(to: URL(fileURLWithPath: job.1))) != nil
          }
        }
        print("{\"src\":\"\(job.0)\",\"out\":\"\(job.1)\",\"saved\":\(saved),\"page\":\(report)}")
        fflush(stdout)
        if snapError != nil { print("{\"snapError\":\"\(String(describing: snapError))\"}") }
        self.next()
      }
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let runner = Runner()
runner.next()
app.run()
