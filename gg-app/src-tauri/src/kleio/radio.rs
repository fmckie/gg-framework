//! Kleio — local radio playback for remote mode.
//!
//! When Kleio Desktop is paired to a host, every sidecar route goes to that
//! host, so the radio used to play out of the HOST's speakers. Audio belongs to
//! the Mac the user is sitting at: in remote mode the host only supplies the
//! station list (`GET /radio`) and this module plays the stream locally,
//! mirroring GG Coder's player (`packages/ggcoder/src/core/radio.ts`).
//! Players are spawned with argument arrays only — never through a shell.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

#[cfg(windows)]
use std::os::windows::process::CommandExt as _;

/// Same default as the sidecar's player.
pub const DEFAULT_VOLUME: u8 = 70;
const MAX_URL_BYTES: usize = 2048;
/// Only network protocols a radio stream needs (no `file:`, `pipe:`, …).
const PROTOCOL_WHITELIST: &str = "http,https,tcp,tls,crypto";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerKind {
    /// macOS: ffmpeg → AudioToolbox, live gain over stdin.
    Ffmpeg,
    Mpv,
    Ffplay,
    Mpg123,
    Cvlc,
}

impl PlayerKind {
    /// Fallback players in priority order (after ffmpeg on macOS).
    pub const FALLBACKS: [PlayerKind; 4] = [
        PlayerKind::Mpv,
        PlayerKind::Ffplay,
        PlayerKind::Mpg123,
        PlayerKind::Cvlc,
    ];

    pub fn cmd(self) -> &'static str {
        match self {
            PlayerKind::Ffmpeg => "ffmpeg",
            PlayerKind::Mpv => "mpv",
            PlayerKind::Ffplay => "ffplay",
            PlayerKind::Mpg123 => "mpg123",
            PlayerKind::Cvlc => "cvlc",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Linux,
    Windows,
    Other,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(target_os = "linux") {
            Os::Linux
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Other
        }
    }

    /// Install dirs a GUI app's minimal PATH usually omits (Homebrew, MacPorts).
    fn extra_dirs(self) -> &'static [&'static str] {
        match self {
            Os::Mac => &["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"],
            Os::Linux => &["/usr/bin", "/usr/local/bin", "/bin", "/snap/bin"],
            Os::Windows | Os::Other => &[],
        }
    }
}

/// `volume / 100` the way JS stringifies it: 70 → "0.7", 100 → "1", 5 → "0.05".
pub fn gain(volume: u8) -> String {
    format!("{}", f64::from(volume) / 100.0)
}

pub fn player_args(kind: PlayerKind, url: &str, volume: u8) -> Vec<String> {
    let s = |v: &str| v.to_string();
    match kind {
        PlayerKind::Ffmpeg => vec![
            s("-loglevel"),
            s("quiet"),
            s("-protocol_whitelist"),
            s(PROTOCOL_WHITELIST),
            s("-i"),
            s(url),
            s("-vn"),
            s("-af"),
            format!("volume@radio={}", gain(volume)),
            s("-f"),
            s("audiotoolbox"),
            s("-"),
        ],
        PlayerKind::Mpv => vec![
            s("--really-quiet"),
            s("--no-video"),
            s("--no-terminal"),
            format!("--volume={volume}"),
            s(url),
        ],
        PlayerKind::Ffplay => vec![
            s("-nodisp"),
            s("-autoexit"),
            s("-loglevel"),
            s("quiet"),
            s("-volume"),
            volume.to_string(),
            s("-protocol_whitelist"),
            s(PROTOCOL_WHITELIST),
            s(url),
        ],
        PlayerKind::Mpg123 => {
            let scale = (32768.0 * (f64::from(volume) / 100.0)).round() as u32;
            vec![s("-q"), s("-f"), scale.to_string(), s(url)]
        }
        PlayerKind::Cvlc => vec![
            s("--play-and-exit"),
            s("--quiet"),
            s("--gain"),
            format!("{:.2}", f64::from(volume) / 100.0),
            s(url),
        ],
    }
}

/// The line ffmpeg's interactive stdin takes to retune the `volume@radio` filter.
pub fn live_gain_command(volume: u8) -> String {
    format!("cvolume@radio -1 volume {}\n", gain(volume))
}

pub fn validate_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Station URL must be http(s)".into());
    }
    if url.len() > MAX_URL_BYTES {
        return Err("Station URL is too long".into());
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Station URL contains invalid characters".into());
    }
    Ok(())
}

/// Look up a station's stream URL by id in the host's `GET /radio` body.
pub fn station_url(radio: &serde_json::Value, id: &str) -> Result<String, String> {
    let station = radio
        .get("stations")
        .and_then(|v| v.as_array())
        .and_then(|list| {
            list.iter()
                .find(|s| s.get("id").and_then(|v| v.as_str()) == Some(id))
        })
        .ok_or_else(|| format!("Unknown station: {id}"))?;
    station
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Station {id} has no stream URL"))
}

/// PATH entries, then the OS's well-known install dirs.
pub fn search_dirs(path_var: Option<&std::ffi::OsStr>, os: Os) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path_var
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    dirs.retain(|d| !d.as_os_str().is_empty());
    dirs.extend(os.extra_dirs().iter().map(PathBuf::from));
    dirs
}

/// Every runnable player in priority order. Windows defers lookup to the OS
/// (PATHEXT), so bare names are returned and a spawn failure moves on.
pub fn resolve_players(
    dirs: &[PathBuf],
    os: Os,
    exists: impl Fn(&Path) -> bool,
) -> Vec<(PlayerKind, PathBuf)> {
    if os == Os::Windows {
        return PlayerKind::FALLBACKS
            .iter()
            .map(|k| (*k, PathBuf::from(k.cmd())))
            .collect();
    }
    let find = |cmd: &str| dirs.iter().map(|d| d.join(cmd)).find(|p| exists(p));
    let mut out = Vec::new();
    if os == Os::Mac {
        let adjacent = find("ffplay")
            .and_then(|p| p.parent().map(|d| d.join("ffmpeg")))
            .filter(|p| exists(p));
        if let Some(ffmpeg) = adjacent.or_else(|| find("ffmpeg")) {
            out.push((PlayerKind::Ffmpeg, ffmpeg));
        }
    }
    for kind in PlayerKind::FALLBACKS {
        if let Some(bin) = find(kind.cmd()) {
            out.push((kind, bin));
        }
    }
    out
}

/// Same text as radio.ts `buildInstallHint`.
pub fn install_hint(os: Os) -> String {
    let base = "Radio needs a streaming player. Install one of: mpv (recommended), ffplay, mpg123, or vlc.";
    match os {
        Os::Mac => {
            format!("{base} On macOS: `brew install mpv` (or `brew install ffmpeg` for ffplay).")
        }
        Os::Linux => format!(
            "{base} On Linux (Debian/Ubuntu): `sudo apt install mpv`. Fedora: `sudo dnf install mpv`. Arch: `sudo pacman -S mpv`."
        ),
        Os::Windows => {
            format!("{base} On Windows: `winget install mpv.mpv` (or download from https://mpv.io).")
        }
        Os::Other => base.to_string(),
    }
}

/// The host's station list (`GET {base}/radio`). Its `current`/`volume`
/// describe the HOST's player and are ignored in remote mode. Every failure
/// is logged here, so callers may fall back without logging again.
pub async fn host_radio(
    client: &reqwest::Client,
    base: &str,
    gg_sid: &str,
) -> Result<serde_json::Value, String> {
    let fail = |e: String| {
        log::warn!("kleio radio: host station list: {e}");
        e
    };
    let res = client
        .get(format!("{base}/radio"))
        .header("x-gg-session", gg_sid)
        .send()
        .await
        .map_err(|e| fail(e.to_string()))?;
    let status = res.status();
    if !status.is_success() {
        return Err(fail(format!("radio stations: HTTP {status}")));
    }
    res.json::<serde_json::Value>()
        .await
        .map_err(|e| fail(e.to_string()))
}

struct Playing {
    child: Child,
    /// ffmpeg only: its interactive stdin for live gain.
    stdin: Option<ChildStdin>,
    station: String,
    url: String,
}

pub struct Inner {
    playing: Option<Playing>,
    volume: u8,
}

impl Default for Inner {
    fn default() -> Self {
        Inner {
            playing: None,
            volume: DEFAULT_VOLUME,
        }
    }
}

impl Inner {
    fn stop(&mut self) {
        if let Some(mut p) = self.playing.take() {
            drop(p.stdin.take());
            let _ = p.child.kill();
            let _ = p.child.wait();
            log::info!("kleio radio: stopped {}", p.station);
        }
    }

    /// Clear a player that exited on its own (stream ended, device error).
    fn reap_exited(&mut self) {
        let exited = match self.playing.as_mut() {
            // Only a confirmed exit clears it; on a `try_wait` error keep the
            // child so `stop()` can still kill it (never leak audio).
            Some(p) => matches!(p.child.try_wait(), Ok(Some(_))),
            None => false,
        };
        if exited {
            if let Some(p) = self.playing.take() {
                log::warn!("kleio radio: player for {} exited", p.station);
            }
        }
    }

    fn play(&mut self, station: &str, url: &str) -> Result<(), String> {
        validate_url(url)?;
        self.stop();
        let os = Os::current();
        let path_var = std::env::var_os("PATH");
        let dirs = search_dirs(path_var.as_deref(), os);
        for (kind, bin) in resolve_players(&dirs, os, |p| p.is_file()) {
            let live = kind == PlayerKind::Ffmpeg;
            let mut cmd = Command::new(&bin);
            cmd.args(player_args(kind, url, self.volume))
                .stdin(if live { Stdio::piped() } else { Stdio::null() })
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(windows)]
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            match cmd.spawn() {
                Ok(mut child) => {
                    let stdin = child.stdin.take();
                    log::info!(
                        "kleio radio: playing {station} locally via {} ({url})",
                        bin.display()
                    );
                    self.playing = Some(Playing {
                        child,
                        stdin,
                        station: station.to_string(),
                        url: url.to_string(),
                    });
                    return Ok(());
                }
                Err(e) => log::warn!("kleio radio: {} failed to start: {e}", bin.display()),
            }
        }
        log::warn!("kleio radio: no compatible player found");
        Err(install_hint(os))
    }

    fn set_volume(&mut self, volume: u8) -> Result<(), String> {
        self.volume = volume;
        self.reap_exited();
        let Some(p) = self.playing.as_mut() else {
            return Ok(());
        };
        if let Some(stdin) = p.stdin.as_mut() {
            let line = live_gain_command(volume);
            match stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()) {
                Ok(()) => return Ok(()),
                Err(e) => log::warn!("kleio radio: live gain failed ({e}); restarting"),
            }
        }
        // No live gain: restart the stream at the new volume.
        let (station, url) = (p.station.clone(), p.url.clone());
        self.play(&station, &url)
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.stop();
    }
}

/// App-wide local player used only in remote mode.
#[derive(Default)]
pub struct LocalRadio(Mutex<Inner>);

impl LocalRadio {
    fn inner(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `(current station id, volume)` of the local player.
    pub fn state(&self) -> (Option<String>, u8) {
        let mut inner = self.inner();
        inner.reap_exited();
        let current = inner.playing.as_ref().map(|p| p.station.clone());
        (current, inner.volume)
    }

    pub fn play(&self, station: &str, url: &str) -> Result<(), String> {
        self.inner().play(station, url)
    }

    pub fn stop(&self) {
        self.inner().stop();
    }

    /// Clamp/round to 0..=100 like radio.ts, apply live (ffmpeg) or restart.
    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        if !volume.is_finite() {
            return Err("Volume must be a number from 0 to 100".into());
        }
        let v = volume.round().clamp(0.0, 100.0) as u8;
        self.inner().set_volume(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn validates_station_urls() {
        let long = format!("https://x.test/{}", "a".repeat(2048));
        let cases: &[(&str, bool)] = &[
            ("https://ice.example.com/stream.mp3", true),
            ("http://ice.example.com:8000/live", true),
            ("ftp://ice.example.com/x", false),
            ("file:///etc/passwd", false),
            ("javascript:alert(1)", false),
            ("", false),
            ("https://a b.test/", false),
            ("https://a.test/\n-i", false),
            ("https://a.test/\u{7}", false),
            ("https://a.test/\t", false),
            (&long, false),
        ];
        for (url, ok) in cases {
            assert_eq!(validate_url(url).is_ok(), *ok, "{url:?}");
        }
        let max = format!("https://x.test/{}", "a".repeat(2048 - 15));
        assert_eq!(max.len(), 2048);
        assert!(validate_url(&max).is_ok());
    }

    #[test]
    fn formats_gain_like_js() {
        assert_eq!(gain(70), "0.7");
        assert_eq!(gain(100), "1");
        assert_eq!(gain(0), "0");
        assert_eq!(gain(5), "0.05");
        assert_eq!(gain(33), "0.33");
    }

    #[test]
    fn builds_player_args() {
        let u = "https://s.test/live";
        let w = "-protocol_whitelist";
        let wl = "http,https,tcp,tls,crypto";
        assert_eq!(
            player_args(PlayerKind::Ffmpeg, u, 70),
            [
                "-loglevel",
                "quiet",
                w,
                wl,
                "-i",
                u,
                "-vn",
                "-af",
                "volume@radio=0.7",
                "-f",
                "audiotoolbox",
                "-"
            ]
        );
        assert_eq!(
            player_args(PlayerKind::Mpv, u, 70),
            [
                "--really-quiet",
                "--no-video",
                "--no-terminal",
                "--volume=70",
                u
            ]
        );
        assert_eq!(
            player_args(PlayerKind::Ffplay, u, 70),
            [
                "-nodisp",
                "-autoexit",
                "-loglevel",
                "quiet",
                "-volume",
                "70",
                w,
                wl,
                u
            ]
        );
        assert_eq!(
            player_args(PlayerKind::Mpg123, u, 70),
            ["-q", "-f", "22938", u]
        );
        assert_eq!(player_args(PlayerKind::Mpg123, u, 100)[2], "32768");
        assert_eq!(player_args(PlayerKind::Mpg123, u, 0)[2], "0");
        assert_eq!(
            player_args(PlayerKind::Cvlc, u, 70),
            ["--play-and-exit", "--quiet", "--gain", "0.70", u]
        );
        assert_eq!(player_args(PlayerKind::Cvlc, u, 100)[3], "1.00");
    }

    #[test]
    fn live_gain_line() {
        assert_eq!(live_gain_command(70), "cvolume@radio -1 volume 0.7\n");
        assert_eq!(live_gain_command(100), "cvolume@radio -1 volume 1\n");
        assert_eq!(live_gain_command(0), "cvolume@radio -1 volume 0\n");
    }

    fn fake(paths: &[&str]) -> impl Fn(&Path) -> bool {
        let set: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |p: &Path| set.contains(p)
    }

    #[test]
    fn search_dirs_put_path_before_extras() {
        let path = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let dirs = search_dirs(Some(path.as_os_str()), Os::Mac);
        let want: Vec<PathBuf> = [
            "/usr/bin",
            "/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/local/bin",
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        assert_eq!(dirs, want);
        assert!(search_dirs(None, Os::Windows).is_empty());
    }

    #[test]
    fn resolves_players_in_priority_order() {
        let dirs = search_dirs(Some(std::ffi::OsStr::new("/usr/bin")), Os::Mac);
        let kinds = |found: &[(PlayerKind, PathBuf)]| -> Vec<PlayerKind> {
            found.iter().map(|(k, _)| *k).collect()
        };

        // ffmpeg next to ffplay wins over one earlier on PATH; then fallbacks.
        let found = resolve_players(
            &dirs,
            Os::Mac,
            fake(&[
                "/usr/bin/ffmpeg",
                "/opt/local/bin/ffplay",
                "/opt/local/bin/ffmpeg",
                "/opt/homebrew/bin/mpv",
                "/usr/bin/cvlc",
            ]),
        );
        assert_eq!(
            found,
            vec![
                (PlayerKind::Ffmpeg, PathBuf::from("/opt/local/bin/ffmpeg")),
                (PlayerKind::Mpv, PathBuf::from("/opt/homebrew/bin/mpv")),
                (PlayerKind::Ffplay, PathBuf::from("/opt/local/bin/ffplay")),
                (PlayerKind::Cvlc, PathBuf::from("/usr/bin/cvlc")),
            ]
        );

        // No ffplay: ffmpeg comes from the search path.
        let found = resolve_players(&dirs, Os::Mac, fake(&["/opt/homebrew/bin/ffmpeg"]));
        assert_eq!(
            found,
            vec![(
                PlayerKind::Ffmpeg,
                PathBuf::from("/opt/homebrew/bin/ffmpeg")
            )]
        );

        // PATH beats the well-known dirs.
        let found = resolve_players(
            &dirs,
            Os::Mac,
            fake(&["/usr/bin/mpg123", "/opt/homebrew/bin/mpg123"]),
        );
        assert_eq!(
            found,
            vec![(PlayerKind::Mpg123, PathBuf::from("/usr/bin/mpg123"))]
        );

        // ffmpeg is a macOS-only preference.
        let linux = search_dirs(None, Os::Linux);
        let found = resolve_players(&linux, Os::Linux, fake(&["/usr/bin/ffmpeg", "/bin/mpv"]));
        assert_eq!(kinds(&found), vec![PlayerKind::Mpv]);

        // Nothing installed.
        assert!(resolve_players(&dirs, Os::Mac, fake(&[])).is_empty());

        // Windows defers to the OS lookup with bare names.
        let found = resolve_players(&[], Os::Windows, fake(&[]));
        assert_eq!(kinds(&found), PlayerKind::FALLBACKS.to_vec());
        assert_eq!(found[0].1, PathBuf::from("mpv"));
    }

    #[test]
    fn looks_up_station_url() {
        let radio = serde_json::json!({
            "stations": [
                { "id": "lofi", "name": "Lofi", "description": "", "url": "https://s.test/lofi" },
                { "id": "broken", "name": "Broken", "description": "" }
            ],
            "current": "jazz",
            "volume": 10
        });
        assert_eq!(
            station_url(&radio, "lofi").as_deref(),
            Ok("https://s.test/lofi")
        );
        assert_eq!(
            station_url(&radio, "nope"),
            Err("Unknown station: nope".to_string())
        );
        assert!(station_url(&radio, "broken").is_err());
        assert_eq!(
            station_url(&serde_json::json!({}), "lofi"),
            Err("Unknown station: lofi".to_string())
        );
    }

    #[test]
    fn install_hint_matches_sidecar() {
        assert_eq!(
            install_hint(Os::Mac),
            "Radio needs a streaming player. Install one of: mpv (recommended), ffplay, mpg123, or vlc. On macOS: `brew install mpv` (or `brew install ffmpeg` for ffplay)."
        );
    }

    #[test]
    fn idle_player_reports_defaults_and_stops_cleanly() {
        let radio = LocalRadio::default();
        assert_eq!(radio.state(), (None, DEFAULT_VOLUME));
        assert!(radio.set_volume(f64::NAN).is_err());
        assert!(radio.set_volume(140.4).is_ok());
        assert_eq!(radio.state(), (None, 100));
        assert!(radio.set_volume(-3.0).is_ok());
        assert_eq!(radio.state(), (None, 0));
        assert!(radio.play("x", "file:///etc/passwd").is_err());
        radio.stop();
        assert_eq!(radio.state().0, None);
    }
}
