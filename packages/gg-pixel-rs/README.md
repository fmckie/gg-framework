# gg-pixel (Rust)

Universal error tracking pixel — Rust SDK. Same wire format as the Node,
Browser, and Python SDKs.

## Install

```toml
[dependencies]
gg-pixel = "4.3.70"
```

## Use

```rust
use gg_pixel::{init_pixel, capture, PixelOptions};

fn main() {
    init_pixel(PixelOptions {
        project_key: std::env::var("GG_PIXEL_KEY").unwrap_or_default(),
        ..Default::default()
    });

    // Anything that panics from this point on is automatically reported.

    // You can also report manually:
    if let Err(e) = risky() {
        capture(&format!("risky failed: {}", e));
    }
}
```

By default `init_pixel` installs a `panic::set_hook` that captures unwinds
and posts them to your gg-pixel backend. The previous panic hook is preserved
and called after capture, so default panic behavior (printing the panic
message + backtrace, aborting) is unchanged.
