import Foundation

/// Capture a stack from `Thread.callStackSymbols`.
///
/// Swift / iOS stack symbols are demangled at runtime via the Mach-O symbol
/// table — they look like:
///
///   "0  GGPixelTests       0x0000000100000abc $sSo... + 12"
///   "1  libsystem_c.dylib  0x0000000100000def __pthread_kill + 8"
///
/// We extract the function-name portion (post-demangle) where possible.
/// Files / line numbers aren't available without dSYM / Crashlytics-style
/// post-processing, so we report file="<unknown>", line=0 — but the function
/// names + module are still useful for the agent.
public enum SwiftStack {
    public static func capture() -> [StackFrame] {
        let symbols = Thread.callStackSymbols
        var frames: [StackFrame] = []
        for line in symbols {
            // Format: "<n>  <module>  <addr> <symbol> + <offset>"
            let parts = line.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
            guard parts.count >= 3 else { continue }
            let module = parts.count >= 2 ? parts[1] : "<unknown>"
            let symbolStart = parts.count >= 4 ? 3 : 2
            let symbol = parts[symbolStart..<parts.count].joined(separator: " ")
            let cleaned = stripOffset(from: symbol)
            let demangled = demangleSwiftSymbol(cleaned) ?? cleaned
            let inApp = !module.hasPrefix("libsystem")
                && !module.hasPrefix("Foundation")
                && !module.hasPrefix("CoreFoundation")
                && !module.hasPrefix("CoreServices")
                && !module.hasPrefix("dyld")
            frames.append(StackFrame(
                file: module,
                line: 0,
                col: 0,
                fn: demangled,
                in_app: inApp
            ))
        }
        // Strip frames belonging to our own SDK so the agent sees user code first.
        while let top = frames.first, top.fn.contains("GGPixel.") {
            frames.removeFirst()
        }
        return frames
    }

    private static func stripOffset(from s: String) -> String {
        // Symbols often end with "+ <offset>" — strip it.
        if let r = s.range(of: " + ") {
            return String(s[..<r.lowerBound])
        }
        return s
    }

    private static func demangleSwiftSymbol(_ symbol: String) -> String? {
        // Foundation provides _stdlib_demangleName via private API.
        // We use `swift_demangle_getDemangledName` if available, else return nil.
        // Most importantly: don't crash if the symbol can't be demangled.
        // For the v1 SDK we just return the symbol as-is.
        return nil
    }
}
