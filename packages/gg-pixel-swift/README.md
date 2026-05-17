# GGPixel (Swift)

iOS / macOS / tvOS / watchOS error tracking — same wire format as the JS,
Python, and Rust SDKs.

## Install

Swift Package Manager — add to `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/kenkaiiii/gg-pixel-swift", from: "4.3.70")
]
```

Or via Xcode: File → Add Packages → paste the repo URL.

## Use

```swift
import GGPixel

@main
struct MyApp: App {
    init() {
        GGPixel.shared.initialize(projectKey: "pk_live_...")
    }
    var body: some Scene { /* … */ }
}
```

Hooks installed by default:
- `NSSetUncaughtExceptionHandler` — catches `NSException` (Obj-C exceptions)
- `signal(SIGABRT, …)` etc. — catches POSIX signals (Swift fatal errors)

## Manual reporting

```swift
GGPixel.shared.report("user clicked the broken button")

do {
    try risky()
} catch {
    GGPixel.shared.captureError(error)
}
```
