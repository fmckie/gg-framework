import Foundation

// `NSSetUncaughtExceptionHandler` takes a `@convention(c)` function pointer
// — it cannot capture context. So we use a top-level `@convention(c)`
// function and stash the previous handler in a global, the canonical Swift
// pattern for this API.
//
// Swift fatal errors / SIGABRT etc. don't flow through this — Apple's
// recommendation for those is a crash reporter (PLCrashReporter,
// KSCrashRecording). We capture Obj-C exceptions; that gap is documented.
//
// We preserve any prior handler so we don't silently disable the host
// app's existing crash reporter (e.g. Crashlytics).

private var ggPixelPreviousExceptionHandler: (@convention(c) (NSException) -> Void)?

private let ggPixelExceptionHandler: @convention(c) (NSException) -> Void = { exception in
    let event = GGPixel.shared.eventFromException(exception, fatal: true)
    GGPixel.shared.emitSyncForFatal(event)
    ggPixelPreviousExceptionHandler?(exception)
}

func installUncaughtExceptionHandler() {
    ggPixelPreviousExceptionHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler(ggPixelExceptionHandler)
}
