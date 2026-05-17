import Foundation

public final class GGPixel {
    public static let shared = GGPixel()

    public static let DEFAULT_INGEST_URL =
        "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest"

    private var sink: Sink?
    private var projectKey: String = ""
    private var runtime: String = "swift"
    private var initialized = false
    private let lock = NSLock()

    private init() {}

    /// Initialize gg-pixel. Call once at app startup.
    public func initialize(
        projectKey: String,
        ingestUrl: String = GGPixel.DEFAULT_INGEST_URL,
        runtime: String? = nil,
        captureUncaughtExceptions: Bool = true
    ) {
        lock.lock()
        defer { lock.unlock() }
        if initialized {
            print("[gg-pixel] already initialized — ignoring")
            return
        }
        self.projectKey = projectKey
        self.sink = HttpSink(ingestUrl: ingestUrl)
        self.runtime = runtime ?? Self.defaultRuntime()
        self.initialized = true

        if captureUncaughtExceptions {
            installUncaughtExceptionHandler()
        }
    }

    /// Manual report.
    public func report(_ message: String, level: Level = .error) {
        guard initialized, let sink = sink else { return }
        let stack = SwiftStack.capture()
        let event = WireEvent(
            event_id: UUID().uuidString.lowercased(),
            project_key: projectKey,
            fingerprint: Fingerprint.compute(type: "ManualReport", stack: stack),
            type: "ManualReport",
            message: message,
            stack: stack,
            code_context: nil,
            runtime: runtime,
            manual_report: true,
            level: level,
            occurred_at: Self.iso8601Now()
        )
        sink.emit(event) { _ in /* fire-and-forget */ }
    }

    /// Capture an arbitrary `Error`.
    public func captureError(_ error: Error, level: Level = .error) {
        guard initialized, let sink = sink else { return }
        let stack = SwiftStack.capture()
        let typeName = "\(type(of: error))"
        let event = WireEvent(
            event_id: UUID().uuidString.lowercased(),
            project_key: projectKey,
            fingerprint: Fingerprint.compute(type: typeName, stack: stack),
            type: typeName,
            message: "\(error)",
            stack: stack,
            code_context: nil,
            runtime: runtime,
            manual_report: true,
            level: level,
            occurred_at: Self.iso8601Now()
        )
        sink.emit(event) { _ in }
    }

    // ── internal: build an event from an NSException ────────────────

    func eventFromException(_ exception: NSException, fatal: Bool) -> WireEvent {
        let stack: [StackFrame] = exception.callStackSymbols.enumerated().map { i, sym in
            // Best-effort: frame structure is "<n>  <module>  <addr>  <symbol> + <offset>"
            let parts = sym.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
            let module = parts.count >= 2 ? parts[1] : "<unknown>"
            let symbol: String
            if parts.count >= 4 {
                symbol = parts[3..<parts.count].joined(separator: " ")
            } else {
                symbol = sym
            }
            let inApp = !module.hasPrefix("libsystem")
                && !module.hasPrefix("Foundation")
                && !module.hasPrefix("CoreFoundation")
                && !module.hasPrefix("dyld")
            return StackFrame(file: module, line: i, col: 0, fn: symbol, in_app: inApp)
        }
        let typeName = exception.name.rawValue
        let message = exception.reason ?? typeName
        return WireEvent(
            event_id: UUID().uuidString.lowercased(),
            project_key: projectKey,
            fingerprint: Fingerprint.compute(type: typeName, stack: stack),
            type: typeName,
            message: message,
            stack: stack,
            code_context: nil,
            runtime: runtime,
            manual_report: false,
            level: fatal ? .fatal : .error,
            occurred_at: Self.iso8601Now()
        )
    }

    func emitSyncForFatal(_ event: WireEvent) {
        if let httpSink = sink as? HttpSink {
            _ = httpSink.emitSync(event)
        }
    }

    // ── helpers ────────────────────────────────────────────────────

    private static func defaultRuntime() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        #if os(iOS)
        return "ios-\(v.majorVersion).\(v.minorVersion)"
        #elseif os(macOS)
        return "macos-\(v.majorVersion).\(v.minorVersion)"
        #elseif os(tvOS)
        return "tvos-\(v.majorVersion).\(v.minorVersion)"
        #elseif os(watchOS)
        return "watchos-\(v.majorVersion).\(v.minorVersion)"
        #else
        return "swift"
        #endif
    }

    private static func iso8601Now() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
}
