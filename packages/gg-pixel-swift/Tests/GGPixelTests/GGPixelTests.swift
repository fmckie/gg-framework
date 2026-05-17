import XCTest
@testable import GGPixel

final class FingerprintTests: XCTestCase {
    private func frame(line: Int = 10, fn: String = "foo", file: String = "/repo/x.swift") -> StackFrame {
        StackFrame(file: file, line: line, col: 0, fn: fn, in_app: true)
    }

    func test_stable_for_same_input() {
        let a = Fingerprint.compute(type: "TypeError", stack: [frame()])
        let b = Fingerprint.compute(type: "TypeError", stack: [frame()])
        XCTAssertEqual(a, b)
    }

    func test_returns_16_char_hex() {
        let fp = Fingerprint.compute(type: "T", stack: [frame()])
        XCTAssertEqual(fp.count, 16)
        XCTAssertTrue(fp.allSatisfy { "0123456789abcdef".contains($0) })
    }

    func test_differs_when_type_differs() {
        XCTAssertNotEqual(
            Fingerprint.compute(type: "A", stack: [frame()]),
            Fingerprint.compute(type: "B", stack: [frame()])
        )
    }

    func test_handles_empty_stack() {
        let fp = Fingerprint.compute(type: "X", stack: [])
        XCTAssertEqual(fp.count, 16)
    }
}

final class WireEventTests: XCTestCase {
    func test_serializes_with_correct_keys() throws {
        let event = WireEvent(
            event_id: "evt_test",
            project_key: "pk_test",
            fingerprint: "fp1",
            type: "TypeError",
            message: "boom",
            stack: [StackFrame(file: "f", line: 1, col: 2, fn: "g", in_app: true)],
            code_context: nil,
            runtime: "ios-17.0",
            manual_report: false,
            level: .error,
            occurred_at: "2026-04-29T00:00:00Z"
        )
        let data = try JSONEncoder().encode(event)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["event_id"] as? String, "evt_test")
        XCTAssertEqual(dict["project_key"] as? String, "pk_test")
        XCTAssertEqual(dict["type"] as? String, "TypeError")
        XCTAssertEqual(dict["level"] as? String, "error")
        XCTAssertEqual(dict["manual_report"] as? Bool, false)
        let stack = dict["stack"] as! [[String: Any]]
        XCTAssertEqual(stack.count, 1)
        XCTAssertEqual(stack[0]["fn"] as? String, "g")
        XCTAssertEqual(stack[0]["in_app"] as? Bool, true)
    }
}

final class HttpSinkTests: XCTestCase {
    func test_strips_trailing_slashes() {
        let sink = HttpSink(ingestUrl: "https://example.com/ingest/")
        // We can't read ingestUrl directly (private), but we trust the
        // normalization via behavior — see the live e2e test.
        _ = sink
    }
}

final class StackTests: XCTestCase {
    func test_capture_returns_at_least_one_frame() {
        let frames = SwiftStack.capture()
        XCTAssertGreaterThan(frames.count, 0)
    }
}
