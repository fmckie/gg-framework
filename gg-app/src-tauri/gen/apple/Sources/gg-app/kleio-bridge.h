// What Swift in the app may call in the Rust library (src/kleio/live.rs).
#pragma once
#include <stdint.h>

/// Send a Live Activity button's answer to the Kleio host; blocks until it
/// answers. `json`: {"conversation","askId","key","choice"}. Returns the HTTP
/// status, or a negative number when the request couldn't be made.
int32_t kleio_live_answer(const char *json);

/// "Brief me" (src/kleio/brief.rs): the Kleio host's briefing as words for
/// Siri to say, or why there isn't one; blocks until the host answers. NULL
/// only if the words couldn't be handed over. Free with kleio_string_free.
char *kleio_brief(void);

/// Frees a string the Rust library returned.
void kleio_string_free(char *s);
