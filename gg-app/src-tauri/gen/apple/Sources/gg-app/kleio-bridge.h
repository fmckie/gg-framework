// What Swift in the app may call in the Rust library (src/kleio/live.rs).
#pragma once
#include <stdint.h>

/// Send a Live Activity button's answer to the Kleio host; blocks until it
/// answers. `json`: {"conversation","askId","key","choice"}. Returns the HTTP
/// status, or a negative number when the request couldn't be made.
int32_t kleio_live_answer(const char *json);
