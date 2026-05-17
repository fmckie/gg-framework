import Foundation
import GGPixel

guard let key = ProcessInfo.processInfo.environment["GG_PIXEL_KEY"] else {
    print("set GG_PIXEL_KEY=pk_live_...")
    exit(1)
}

GGPixel.shared.initialize(projectKey: key)

// Manual report
GGPixel.shared.report("swift-smoke: manual report from main.swift")

// captureError with a thrown error
struct ValidationError: Error, CustomStringConvertible {
    let description: String
}
do {
    throw ValidationError(description: "swift-smoke: caught ValidationError")
} catch {
    GGPixel.shared.captureError(error)
}

// Give the async URLSession dataTask time to flush before raising.
Thread.sleep(forTimeInterval: 1.0)

// Now crash via NSException — uncaught, should hit our sync handler before exit.
NSException(
    name: NSExceptionName("ValidationCrash"),
    reason: "swift-smoke: REAL UNCAUGHT NSException via raise()",
    userInfo: nil
).raise()
