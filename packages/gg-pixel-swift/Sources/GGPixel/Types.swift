import Foundation

public enum Level: String, Codable {
    case error
    case warning
    case fatal
}

public struct StackFrame: Codable {
    public let file: String
    public let line: Int
    public let col: Int
    public let `fn`: String
    public let in_app: Bool

    public init(file: String, line: Int, col: Int, fn: String, in_app: Bool) {
        self.file = file
        self.line = line
        self.col = col
        self.fn = fn
        self.in_app = in_app
    }
}

public struct CodeContext: Codable {
    public let file: String
    public let error_line: Int
    public let lines: [String]
}

public struct WireEvent: Codable {
    public let event_id: String
    public let project_key: String
    public let fingerprint: String
    public let type: String
    public let message: String
    public let stack: [StackFrame]
    public let code_context: CodeContext?
    public let runtime: String
    public let manual_report: Bool
    public let level: Level
    public let occurred_at: String
}
