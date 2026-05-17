//! Live smoke: panic + manual report against the deployed worker.

use std::env;
use std::time::Duration;

use gg_pixel::{capture, init_pixel, PixelOptions};

fn main() {
    let key = env::var("GG_PIXEL_KEY").expect("set GG_PIXEL_KEY=pk_live_...");
    init_pixel(PixelOptions {
        project_key: key,
        ..Default::default()
    })
    .expect("init failed");

    capture("rust-smoke: manual report from main()");
    std::thread::sleep(Duration::from_millis(200));
    gg_pixel::flush(Duration::from_secs(2));

    // Now panic — the panic hook does a sync emit before unwinding.
    let v: Vec<i32> = vec![];
    let _bad = v[42]; // out of bounds — panics
}
