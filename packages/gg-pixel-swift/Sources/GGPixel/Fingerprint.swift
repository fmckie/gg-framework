import Foundation
import CryptoKit

/// Stable fingerprint of an error for grouping recurrences.
/// sha256(`type|normalized_top_frame|fn|line`), 16 hex chars.
public enum Fingerprint {
    public static func compute(type: String, stack: [StackFrame]) -> String {
        let normalized: String
        if let top = stack.first {
            let fn = top.fn.isEmpty ? "<anon>" : top.fn
            normalized = "\(type)|\(normalizeFile(top.file))|\(fn)|\(top.line)"
        } else {
            normalized = "\(type)|<no-stack>"
        }
        let digest = SHA256.hash(data: Data(normalized.utf8))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    private static func normalizeFile(_ file: String) -> String {
        // Strip path prefixes that vary between machines.
        let clean = file.split(separator: "?").first.map(String.init) ?? file
        if let r = clean.range(of: "/Pods/") {
            return "Pods/" + String(clean[r.upperBound...])
        }
        if let r = clean.range(of: "/.build/") {
            return ".build/" + String(clean[r.upperBound...])
        }
        return clean
    }
}
