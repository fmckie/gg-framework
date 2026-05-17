use crate::types::StackFrame;

/// Convert a `backtrace::Backtrace` into the universal StackFrame shape.
/// We resolve symbols (function names + file:line) and mark frames as
/// `in_app` based on a simple heuristic: anything outside cargo registry
/// and stdlib is treated as user code.
pub fn capture_stack() -> Vec<StackFrame> {
    let bt = backtrace::Backtrace::new();
    let mut frames = Vec::new();
    for frame in bt.frames() {
        for symbol in frame.symbols() {
            let file = symbol
                .filename()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let fn_ = symbol
                .name()
                .map(|n| {
                    let s = n.to_string();
                    // Strip the trailing hash that Rust mangles in (e.g. ::h1234abcd).
                    if let Some(idx) = s.rfind("::h") {
                        if s[idx + 3..].chars().all(|c| c.is_ascii_hexdigit()) {
                            return s[..idx].to_string();
                        }
                    }
                    s
                })
                .unwrap_or_else(|| "<anon>".to_string());
            let line = symbol.lineno().unwrap_or(0);
            let col = symbol.colno().unwrap_or(0);
            frames.push(StackFrame {
                in_app: is_in_app(&file, &fn_),
                file,
                line,
                col,
                fn_,
            });
        }
    }
    // Strip our own SDK frames from the top so the agent sees the user's code first.
    while let Some(top) = frames.first() {
        if top.fn_.starts_with("gg_pixel::")
            || top.fn_.starts_with("backtrace::")
            || top.fn_.contains("::__rust_begin_short_backtrace")
        {
            frames.remove(0);
        } else {
            break;
        }
    }
    frames
}

fn is_in_app(file: &str, fn_: &str) -> bool {
    if file.is_empty() {
        return false;
    }
    if file.contains("/.cargo/registry/") {
        return false;
    }
    if file.contains("/rustc/") {
        return false;
    }
    if fn_.starts_with("std::")
        || fn_.starts_with("core::")
        || fn_.starts_with("alloc::")
        || fn_.starts_with("__rust")
    {
        return false;
    }
    true
}
