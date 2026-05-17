use sha2::{Digest, Sha256};

use crate::types::StackFrame;

/// Stable fingerprint of an error for grouping recurrences.
/// Same algorithm as the Node/Browser/Python SDKs:
///   sha256(`type|normalized_top_frame|fn|line`), truncated to 16 hex chars.
pub fn fingerprint(type_: &str, stack: &[StackFrame]) -> String {
    let normalized = match stack.first() {
        Some(top) => format!(
            "{}|{}|{}|{}",
            type_,
            normalize_file(&top.file),
            if top.fn_.is_empty() { "<anon>" } else { &top.fn_ },
            top.line
        ),
        None => format!("{}|<no-stack>", type_),
    };

    let digest = Sha256::digest(normalized.as_bytes());
    let mut s = String::with_capacity(16);
    for byte in &digest[..8] {
        s.push_str(&format!("{:02x}", byte));
    }
    s
}

fn normalize_file(file: &str) -> String {
    // Strip path prefixes that vary between machines so the same library
    // error fingerprints identically everywhere.
    let s = file.split('?').next().unwrap_or(file);
    if let Some(idx) = s.find("/.cargo/registry/") {
        return format!(".cargo/registry/{}", &s[idx + "/.cargo/registry/".len()..]);
    }
    if let Some(idx) = s.find("/target/") {
        return format!("target/{}", &s[idx + "/target/".len()..]);
    }
    s.to_string()
}
