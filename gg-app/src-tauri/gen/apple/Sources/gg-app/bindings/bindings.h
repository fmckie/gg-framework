#pragma once

namespace ffi {
    extern "C" {
        void start_app();

        // kleio: Live Activities. Swift (KleioLiveActivities.swift) talks to
        // ActivityKit; Rust (src/kleio/live.rs) is handed its two entry points
        // here, so the Rust library itself never names a Swift symbol (it is
        // also linked on its own as a dylib, where those would be missing).
        typedef void (*kleio_live_report)(const char *json);
        void kleio_live_begin(kleio_live_report report);
        void kleio_live_start(const char *json);
        void kleio_live_install(void (*begin)(kleio_live_report), void (*start)(const char *));
    }
}

