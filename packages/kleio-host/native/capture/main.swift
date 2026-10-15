// kleio-capture: draws a web page or a page of a PDF as a PNG, for a Kleio
// voice show. The Kleio host (src/capture.ts) runs it with the mode as its one
// argument and the job as JSON on stdin, and reads one JSON line back from
// stdout. Failures are answers too ({"ok":false,"error":...}, exit 0); a
// non-zero exit means the helper itself broke.
//
//   kleio-capture web       load an http(s) page and draw it
//   kleio-capture pdf-info  count a PDF's pages
//   kleio-capture pdf-page  draw one page of a PDF
//   kleio-capture --version
//
// A web page is loaded with nothing of the user's: a data store that keeps
// nothing, and every connection through the host's SOCKS5 proxy for this
// capture (capture-proxy.ts), which only reaches public addresses, with no
// direct connection if the proxy fails. On top of that, here:
//   - content rules block private and local hosts before any request is made;
//   - the main frame may only go to http and https pages, and nothing opens a
//     window, downloads a file, asks for a camera or picks a file;
//   - WebRTC is switched off (the engine's preference where it has one, and
//     removed from every frame's script either way), so nothing leaves as UDP.
// The page is drawn a screen at a time, scrolling down it, and the screens
// stitched together: it keeps its real layout at the viewport's size (a
// `100vh` hero is one screen tall), lazy images load as it scrolls, and what
// is pinned to the window (headers, banners) is shown once, on the first
// screen. (WebKit's createPDF would draw it in one go, but loses transparency
// in gradients: fades and loading placeholders come out black.)

import AppKit
import Foundation
import ImageIO
import Network
import PDFKit
import UniformTypeIdentifiers
import WebKit

let helperVersion = 1

// MARK: - Answers

var cleanups: [() -> Void] = []

/// Writes one JSON line and exits; the only way out once a job is read.
func answer(_ object: [String: Any]) -> Never {
  for cleanup in cleanups { cleanup() }
  if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  }
  exit(0)
}

func failed(_ error: String, _ detail: String? = nil, _ extra: [String: Any] = [:]) -> Never {
  var object: [String: Any] = ["ok": false, "error": error]
  if let detail { object["detail"] = String(detail.prefix(300)) }
  for (key, value) in extra { object[key] = value }
  answer(object)
}

func readJob<T: Decodable>(_ type: T.Type) -> T {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard data.count <= 64 * 1024 else { failed("bad_job", "the job is too big") }
  do {
    return try JSONDecoder().decode(T.self, from: data)
  } catch {
    failed("bad_job", "\(error)")
  }
}

func require(_ condition: Bool, _ what: String) {
  if !condition { failed("bad_job", what) }
}

/// An absolute path to a file whose name ends `suffix`, in a folder that exists.
func checkedPath(_ path: String, suffix: String) -> URL {
  require(path.hasPrefix("/") && !path.contains("\0") && path.hasSuffix(suffix), "bad path")
  let url = URL(fileURLWithPath: path).standardizedFileURL
  var isFolder: ObjCBool = false
  let folder = url.deletingLastPathComponent().path
  require(FileManager.default.fileExists(atPath: folder, isDirectory: &isFolder) && isFolder.boolValue, "no folder for \(suffix)")
  return url
}

// MARK: - Drawing

/// Draws a PDF page `widthPx` wide (at most `maxHeightPx` tall, narrower if
/// need be) on white; nil when the page has no size.
func draw(_ page: PDFPage, widthPx: Int, maxHeightPx: Int) -> (CGContext, CGImage)? {
  let box = page.bounds(for: .mediaBox)
  var size = box.size
  if page.rotation % 180 != 0 { size = CGSize(width: size.height, height: size.width) }
  guard size.width >= 1, size.height >= 1 else { return nil }
  var scale = CGFloat(widthPx) / size.width
  if size.height * scale > CGFloat(maxHeightPx) { scale = CGFloat(maxHeightPx) / size.height }
  let width = max(1, Int((size.width * scale).rounded()))
  let height = max(1, Int((size.height * scale).rounded()))
  guard
    let space = CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return nil }
  context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.scaleBy(x: scale, y: scale)
  // Takes the page's rotation into account and draws only inside the box.
  page.draw(with: .mediaBox, to: context)
  guard let image = context.makeImage() else { return nil }
  return (context, image)
}

/// The picture at half its size, for one that is too big as it is.
func halved(_ image: CGImage) -> CGImage? {
  let width = max(1, image.width / 2)
  let height = max(1, image.height / 2)
  guard
    let space = CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return nil }
  context.interpolationQuality = .high
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return context.makeImage()
}

/// A borderless window off every screen, never moved or clipped to fit one.
final class OffscreenWindow: NSWindow {
  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

func png(_ image: CGImage) -> Data? {
  let data = NSMutableData()
  guard
    let destination = CGImageDestinationCreateWithData(
      data as CFMutableData, UTType.png.identifier as CFString, 1, nil)
  else { return nil }
  CGImageDestinationAddImage(destination, image, nil)
  return CGImageDestinationFinalize(destination) ? data as Data : nil
}

/// Whether a drawing has more than one colour (a sparse grid is enough).
func hasContent(_ context: CGContext) -> Bool {
  guard let pixels = context.data else { return false }
  let bytes = pixels.bindMemory(to: UInt8.self, capacity: context.bytesPerRow * context.height)
  var first: UInt32? = nil
  for y in stride(from: 0, to: context.height, by: 16) {
    for x in stride(from: 0, to: context.width, by: 16) {
      let i = y * context.bytesPerRow + x * 4
      let rgb = (UInt32(bytes[i]) << 16) | (UInt32(bytes[i + 1]) << 8) | UInt32(bytes[i + 2])
      if let first, first != rgb { return true }
      first = rgb
    }
  }
  return false
}

func write(_ data: Data, to url: URL) {
  do {
    try data.write(to: url, options: [.atomic])
  } catch {
    failed("write_failed", "\(error)")
  }
}

// MARK: - PDF modes

struct PdfInfoJob: Decodable {
  let file: String
}

struct PdfPageJob: Decodable {
  let file: String
  /// From 1.
  let page: Int
  let width: Int
  let maxHeight: Int
  let maxBytes: Int
  let out: String
}

func openPdf(_ path: String) -> PDFDocument {
  let url = checkedPath(path, suffix: ".pdf")
  guard let document = PDFDocument(url: url) else { failed("unreadable") }
  if document.isLocked && !document.unlock(withPassword: "") { failed("locked") }
  return document
}

func pdfInfo(_ job: PdfInfoJob) -> Never {
  let document = openPdf(job.file)
  var object: [String: Any] = ["ok": true, "pages": document.pageCount]
  if let title = document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String,
    !title.isEmpty
  {
    object["title"] = String(title.prefix(200))
  }
  answer(object)
}

func pdfPage(_ job: PdfPageJob) -> Never {
  require((200...3000).contains(job.width), "width")
  require((200...16000).contains(job.maxHeight), "maxHeight")
  require((1024...(50 * 1024 * 1024)).contains(job.maxBytes), "maxBytes")
  let out = checkedPath(job.out, suffix: ".png")
  let document = openPdf(job.file)
  guard job.page >= 1, job.page <= document.pageCount, let page = document.page(at: job.page - 1)
  else { failed("no_page") }
  guard let (_, image) = draw(page, widthPx: job.width, maxHeightPx: job.maxHeight),
    let data = png(image)
  else { failed("render_failed") }
  guard data.count <= job.maxBytes else { failed("too_big") }
  write(data, to: out)
  answer(["ok": true, "width": image.width, "height": image.height])
}

// MARK: - Web mode

struct ProxyJob: Decodable {
  let port: Int
  let username: String
  let password: String
}

struct WebJob: Decodable {
  let url: String
  let out: String
  /// CSS pixels.
  let width: Int
  let viewportHeight: Int
  let maxHeight: Int
  /// Device pixels per CSS pixel in the PNG.
  let scale: Int
  let mobile: Bool
  let maxBytes: Int
  let loadTimeoutMs: Int
  let settleMs: Int
  let totalTimeoutMs: Int
  let proxy: ProxyJob
}

let desktopAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
let phoneAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"

/// Private and local hosts, blocked before any request (the proxy refuses them
/// too). Content-rule regexes have no `|`, so each range is its own rule.
func contentRules() -> String {
  let start = "^[a-z][a-z0-9+.-]*://([^/@]*@)?"
  let ipv4 = [
    "0\\.", "10\\.", "127\\.", "169\\.254\\.", "172\\.1[6-9]\\.", "172\\.2[0-9]\\.",
    "172\\.3[01]\\.", "192\\.168\\.", "100\\.6[4-9]\\.", "100\\.[7-9][0-9]\\.",
    "100\\.1[01][0-9]\\.", "100\\.12[0-7]\\.", "192\\.0\\.0\\.", "192\\.0\\.2\\.",
    "198\\.1[89]\\.", "198\\.51\\.100\\.", "203\\.0\\.113\\.", "22[4-9]\\.",
    "2[3-4][0-9]\\.", "25[0-5]\\.",
  ].map { $0 + "[0-9.]*[:/]" }
  let names = [
    "localhost\\.?[:/]", "[^/:@]*\\.localhost\\.?[:/]", "[^/:@]*\\.local\\.?[:/]",
    "[^/:@]*\\.internal\\.?[:/]", "[^/:@]*\\.ts\\.net\\.?[:/]", "[^/:@]*\\.home\\.arpa\\.?[:/]",
    // Any IPv6 literal, and any name without a dot ("http://intranet/").
    "\\[", "[^/:.@]+[:/]",
  ]
  let rules = (ipv4 + names).map { pattern -> [String: Any] in
    ["trigger": ["url-filter": start + pattern], "action": ["type": "block"]]
  }
  let data = try! JSONSerialization.data(withJSONObject: rules)
  return String(decoding: data, as: UTF8.self)
}

/// Runs in the page's own world in every frame, before the page's scripts.
let removeWebRTC = """
  (() => {
    const names = ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceCandidate",
      "RTCSessionDescription", "RTCRtpSender", "RTCRtpReceiver", "RTCRtpTransceiver", "RTCDtlsTransport",
      "RTCIceTransport", "RTCSctpTransport", "RTCCertificate", "RTCDTMFSender", "RTCRtpScriptTransform"];
    for (const name of names) {
      try { Object.defineProperty(window, name, { value: undefined, writable: false, configurable: false }); } catch (_) {}
    }
    try {
      if (navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: false });
    } catch (_) {}
  })();
  """

/// Scrollbars would take a strip of the picture.
let hideScrollbars = """
  (() => {
    const style = document.createElement("style");
    style.textContent = "::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}";
    (document.head || document.documentElement).appendChild(style);
  })();
  """

/// Scrolls down the page so lazy images load, comes back up, and measures it.
let settleScript = """
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const root = document.documentElement;
  const height = () => Math.max(root ? root.scrollHeight : 0, document.body ? document.body.scrollHeight : 0);
  const limit = Math.min(height(), maxHeight);
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  for (let y = step, n = 0; y < limit && n < steps; y += step, n++) {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
    await pause(pauseMs);
  }
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  await pause(pauseMs * 2);
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const password = Array.from(document.querySelectorAll('input[type="password"]')).some(shown);
  return { height: height(), password };
  """

/// Scrolls to one screen of the page (`y`, CSS pixels) and says where it got.
/// After the first screen, what is pinned to the window (fixed, or sticky and
/// stuck) is hidden, so a header or banner shows once, not on every screen.
/// It is looked for again on every screen (pages pin things as they scroll),
/// and hidden with opacity, which a child can't undo the way it can undo
/// `visibility: hidden` with its own `visibility: visible`. A sticky element
/// that has come unstuck (its section scrolled past) is shown again. Only
/// what is inside the body is looked at: a page that locks its scrolling pins
/// the body itself, and hiding that would blank the rest of the picture.
let tileScript = """
  // Timers, not animation frames: a window that is never shown gets no frames.
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.scrollTo({ top: y, left: 0, behavior: "instant" });
  await pause(100);
  if (!first) {
    const pinned = [];
    const walk = (root) => {
      for (const e of root.querySelectorAll("*")) {
        const p = getComputedStyle(e).position;
        if (p === "fixed" || p === "sticky") pinned.push(e);
        if (e.shadowRoot) walk(e.shadowRoot);
      }
    };
    if (document.body) walk(document.body);
    const saved = window.__kleioHidden || (window.__kleioHidden = new Map());
    const props = ["transition", "opacity", "visibility"];
    for (const e of pinned) {
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const top = parseFloat(s.top);
      const bottom = parseFloat(s.bottom);
      const stuck = s.position === "fixed" ||
        (!Number.isNaN(top) && Math.abs(r.top - top) <= 2) ||
        (!Number.isNaN(bottom) && Math.abs(window.innerHeight - r.bottom - bottom) <= 2);
      if (stuck && !saved.has(e)) {
        saved.set(e, props.map((p) => [p, e.style.getPropertyValue(p), e.style.getPropertyPriority(p)]));
        e.style.setProperty("transition", "none", "important");
        e.style.setProperty("opacity", "0", "important");
        e.style.setProperty("visibility", "hidden", "important");
      } else if (!stuck && saved.has(e)) {
        const put = (p, value, priority) => value ? e.style.setProperty(p, value, priority) : e.style.removeProperty(p);
        const before = saved.get(e);
        saved.delete(e);
        // Opacity back first, with transitions still off, so it doesn't fade in.
        for (const [p, value, priority] of before) if (p !== "transition") put(p, value, priority);
        void getComputedStyle(e).opacity;
        for (const [p, value, priority] of before) if (p === "transition") put(p, value, priority);
      }
    }
    await pause(50);
  }
  return window.scrollY;
  """

/// A path or host that says "sign in", "subscribe" or "your account".
func looksLikeSignIn(_ url: URL?) -> Bool {
  guard let url else { return false }
  let host = (url.host ?? "").lowercased()
  if ["login.", "signin.", "auth.", "accounts.", "sso."].contains(where: { host.hasPrefix($0) }) {
    return true
  }
  let words: Set<String> = [
    "login", "log-in", "logon", "signin", "sign-in", "sign_in", "auth", "oauth", "sso", "session",
    "sessions", "account", "accounts", "subscribe", "subscription", "subscriptions", "paywall",
    "register", "signup", "sign-up", "join",
  ]
  return url.pathComponents.contains { words.contains($0.lowercased()) }
}

final class WebCapture: NSObject, WKNavigationDelegate, WKUIDelegate {
  let job: WebJob
  let target: URL
  let webView: WKWebView
  let window: NSWindow
  let webRTC: String
  var status: Int?
  var committed = false
  var capturing = false
  var notAPage = false

  init(job: WebJob, target: URL, rules: WKContentRuleList) {
    self.job = job
    self.target = target
    let config = WKWebViewConfiguration()
    let store = WKWebsiteDataStore.nonPersistent()
    var proxy = ProxyConfiguration(
      socksv5Proxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(job.proxy.port))!))
    proxy.allowFailover = false
    proxy.applyCredential(username: job.proxy.username, password: job.proxy.password)
    store.proxyConfigurations = [proxy]
    config.websiteDataStore = store
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    config.preferences.isFraudulentWebsiteWarningEnabled = false
    config.mediaTypesRequiringUserActionForPlayback = .all
    // The engine's own WebRTC switch, where this WebKit has it (private; looked for first).
    if config.preferences.responds(to: NSSelectorFromString("_setPeerConnectionEnabled:")) {
      config.preferences.setValue(false, forKey: "peerConnectionEnabled")
      webRTC = "off"
    } else {
      webRTC = "script"
    }
    let content = config.userContentController
    content.add(rules)
    content.addUserScript(
      WKUserScript(source: removeWebRTC, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page))
    content.addUserScript(
      WKUserScript(
        source: hideScrollbars, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
    // The view is sized in device pixels and the page zoomed to fit, so a screen
    // is `scale` image pixels per CSS pixel on a 1x display or a 2x one alike,
    // and `vh` is still the viewport's height in CSS pixels.
    window = OffscreenWindow(
      contentRect: NSRect(x: 0, y: 0, width: 100, height: 100), styleMask: [.borderless],
      backing: .buffered, defer: false)
    let zoom = CGFloat(job.scale) / max(1, window.backingScaleFactor)
    let frame = NSRect(
      x: 0, y: 0, width: CGFloat(job.width) * zoom, height: CGFloat(job.viewportHeight) * zoom)
    webView = WKWebView(frame: frame, configuration: config)
    webView.pageZoom = zoom
    webView.customUserAgent = job.mobile ? phoneAgent : desktopAgent
    webView.appearance = NSAppearance(named: .aqua)
    super.init()
    window.setContentSize(frame.size)
    window.contentView = webView
    window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
    window.orderBack(nil)
    webView.navigationDelegate = self
    webView.uiDelegate = self
  }

  func start() {
    let load = TimeInterval(job.loadTimeoutMs) / 1000
    webView.load(
      URLRequest(url: target, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: load))
    DispatchQueue.main.asyncAfter(deadline: .now() + load) {
      // Still loading: draw what has arrived, if anything has.
      guard !self.capturing else { return }
      if self.committed {
        self.webView.stopLoading()
        self.capture()
      } else {
        failed("timeout", "the page didn't start to arrive")
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + TimeInterval(job.totalTimeoutMs) / 1000) {
      failed("timeout", "the capture took too long")
    }
  }

  func capture() {
    guard !capturing else { return }
    capturing = true
    DispatchQueue.main.asyncAfter(deadline: .now() + TimeInterval(job.settleMs) / 1000) {
      self.webView.callAsyncJavaScript(
        settleScript, arguments: ["maxHeight": self.job.maxHeight, "steps": 12, "pauseMs": 100],
        in: nil, in: .defaultClient
      ) { result in
        var height = self.job.viewportHeight
        var password = false
        if case .success(let value) = result, let measured = value as? [String: Any] {
          height = max(height, (measured["height"] as? NSNumber)?.intValue ?? height)
          password = (measured["password"] as? Bool) ?? false
        }
        self.drawPage(height: height, password: password)
      }
    }
  }

  /// Draws the page a screen at a time, scrolling down it, onto one picture.
  func drawPage(height: Int, password: Bool) {
    let shown = min(height, job.maxHeight)
    let scale = CGFloat(job.scale)
    let width = Int(CGFloat(job.width) * scale)
    let tall = Int(CGFloat(shown) * scale)
    guard
      let space = CGColorSpace(name: CGColorSpace.sRGB),
      let canvas = CGContext(
        data: nil, width: width, height: tall, bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { failed("render_failed", "no room to draw the page") }
    canvas.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    canvas.fill(CGRect(x: 0, y: 0, width: width, height: tall))
    let screens = Array(stride(from: 0, to: shown, by: job.viewportHeight))

    func screen(_ index: Int) {
      guard index < screens.count else {
        finish(canvas: canvas, height: height, password: password)
        return
      }
      webView.callAsyncJavaScript(
        tileScript, arguments: ["y": screens[index], "first": index == 0], in: nil, in: .defaultClient
      ) { result in
        var top = Double(screens[index])
        if case .success(let value) = result, let at = value as? NSNumber { top = at.doubleValue }
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = true
        self.webView.takeSnapshot(with: config) { image, error in
          guard let image, let tile = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
          else { failed("render_failed", "no snapshot: \(String(describing: error))") }
          // Image pixels, top down; Core Graphics counts from the bottom.
          let tileHeight = CGFloat(tile.height) * CGFloat(width) / CGFloat(max(1, tile.width))
          let y = CGFloat(tall) - CGFloat(top) * scale - tileHeight
          canvas.draw(tile, in: CGRect(x: 0, y: y, width: CGFloat(width), height: tileHeight))
          screen(index + 1)
        }
      }
    }
    screen(0)
  }

  func finish(canvas: CGContext, height: Int, password: Bool) {
    guard hasContent(canvas) else { failed("blank", "the page came out blank") }
    guard let full = canvas.makeImage() else { failed("render_failed") }
    // Too big at 2x: half the size, once.
    var image = full
    var bytes = png(full)
    if (bytes?.count ?? Int.max) > job.maxBytes, let half = halved(full) {
      image = half
      bytes = png(half)
    }
    guard let bytes, bytes.count <= job.maxBytes else { failed("too_big") }
    write(bytes, to: URL(fileURLWithPath: job.out))
    let status = self.status ?? 0
    var object: [String: Any] = [
      "ok": true,
      "status": status,
      "width": image.width,
      "height": image.height,
      "cut": height > job.maxHeight,
      "signIn": [401, 403, 407].contains(status) || password || looksLikeSignIn(webView.url),
      "webrtc": webRTC,
    ]
    if let final = webView.url?.absoluteString, final.count <= 2048 { object["finalUrl"] = final }
    if let title = webView.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
      object["title"] = String(title.prefix(200))
    }
    answer(object)
  }

  // MARK: Navigation

  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let scheme = action.request.url?.scheme?.lowercased() ?? ""
    guard !action.shouldPerformDownload, let frame = action.targetFrame else {
      decisionHandler(.cancel)
      return
    }
    if frame.isMainFrame {
      // http and https only, and the page stays put once drawing has begun.
      decisionHandler((scheme == "http" || scheme == "https") && !capturing ? .allow : .cancel)
    } else {
      decisionHandler(["http", "https", "about", "data", "blob"].contains(scheme) ? .allow : .cancel)
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    if response.isForMainFrame {
      if let http = response.response as? HTTPURLResponse { status = http.statusCode }
      if !response.canShowMIMEType { notAPage = true }
    }
    decisionHandler(response.canShowMIMEType ? .allow : .cancel)
  }

  func webView(
    _ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    // Certificates are checked as usual; nothing else is ever answered.
    if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust {
      completionHandler(.performDefaultHandling, nil)
    } else {
      completionHandler(.rejectProtectionSpace, nil)
    }
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    committed = true
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    capture()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if committed { capture() } else { loadFailed(error) }
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error
  ) {
    if !capturing { loadFailed(error) }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    failed("crashed", "the page's process ended")
  }

  func loadFailed(_ error: Error) -> Never {
    let e = error as NSError
    let detail = "\(e.domain) \(e.code)"
    if notAPage { failed("not_a_page", detail) }
    if e.domain == "WebKitErrorDomain" && [102, 103, 104, 105, 106].contains(e.code) {
      failed("refused", detail)
    }
    if e.domain == NSURLErrorDomain {
      switch e.code {
      case NSURLErrorTimedOut: failed("timeout", detail)
      case NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
        NSURLErrorServerCertificateHasUnknownRoot, NSURLErrorServerCertificateNotYetValid,
        NSURLErrorSecureConnectionFailed, NSURLErrorClientCertificateRejected:
        failed("tls", detail)
      default: break
      }
    }
    failed("unreachable", detail, status.map { ["status": $0] } ?? [:])
  }

  // MARK: Nothing opens, asks or picks

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    nil
  }

  func webView(
    _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }

  func webView(
    _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void
  ) {
    completionHandler(nil)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
  ) {
    completionHandler()
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(false)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void
  ) {
    completionHandler(nil)
  }
}

func web(_ job: WebJob) -> Never {
  require(job.url.count <= 2048, "url too long")
  guard let target = URL(string: job.url), let scheme = target.scheme?.lowercased(),
    scheme == "http" || scheme == "https", let host = target.host, !host.isEmpty
  else { failed("bad_job", "not an http or https URL") }
  require((320...1600).contains(job.width), "width")
  require((480...1600).contains(job.viewportHeight), "viewportHeight")
  require((480...8000).contains(job.maxHeight), "maxHeight")
  require((1...2).contains(job.scale), "scale")
  require((1024...(50 * 1024 * 1024)).contains(job.maxBytes), "maxBytes")
  require((1000...30000).contains(job.loadTimeoutMs), "loadTimeoutMs")
  require((0...5000).contains(job.settleMs), "settleMs")
  require((2000...40000).contains(job.totalTimeoutMs), "totalTimeoutMs")
  require((1...65535).contains(job.proxy.port), "proxy port")
  require(
    (1...255).contains(job.proxy.username.utf8.count) && (1...255).contains(job.proxy.password.utf8.count),
    "proxy credentials")
  _ = checkedPath(job.out, suffix: ".png")

  let app = NSApplication.shared
  app.setActivationPolicy(.prohibited)
  // The compiled rules live in a folder of this run's own, gone when it ends.
  let rulesFolder = FileManager.default.temporaryDirectory
    .appendingPathComponent("kleio-capture-\(getpid())-\(UUID().uuidString)")
  cleanups.append { try? FileManager.default.removeItem(at: rulesFolder) }
  guard (try? FileManager.default.createDirectory(at: rulesFolder, withIntermediateDirectories: true)) != nil,
    let store = WKContentRuleListStore(url: rulesFolder)
  else { failed("setup_failed", "no folder for the content rules") }
  var running: WebCapture? = nil
  store.compileContentRuleList(forIdentifier: "kleio-capture", encodedContentRuleList: contentRules()) {
    list, error in
    guard let list else { failed("setup_failed", "content rules: \(String(describing: error))") }
    running = WebCapture(job: job, target: target, rules: list)
    running?.start()
  }
  app.run()
  exit(0)
}

// MARK: - Main

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
  FileHandle.standardError.write(Data("usage: kleio-capture web|pdf-info|pdf-page|--version < job.json\n".utf8))
  exit(2)
}
switch arguments[1] {
case "--version":
  print("kleio-capture \(helperVersion)")
  exit(0)
case "web":
  web(readJob(WebJob.self))
case "pdf-info":
  pdfInfo(readJob(PdfInfoJob.self))
case "pdf-page":
  pdfPage(readJob(PdfPageJob.self))
default:
  FileHandle.standardError.write(Data("kleio-capture: unknown mode \(arguments[1])\n".utf8))
  exit(2)
}
