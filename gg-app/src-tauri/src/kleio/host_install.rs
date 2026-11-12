//! "On this Mac" (macOS only): this Mac as Kleio's host, installed from the
//! host the app carries in `Contents/Resources/host` (`scripts/stage-host.mjs`).
//!
//! - `kleio_this_mac_kind`: laptop, desktop or unknown, from `pmset -g batt`,
//!   by the host's own rule (`pmsetHasInternalBattery` in `always-on.ts`): a
//!   line for the Mac's own battery means a laptop, and a UPS's doesn't count.
//! - `kleio_host_install`: runs the app's `install-mini.sh` in app mode, with
//!   `/bin/sh`, a cleared environment and a fixed set of variables. Nothing a
//!   person typed reaches it. The script copies the host into
//!   `host-code/<VERSION>` and starts its three launchd jobs; its output goes
//!   to the host's `logs/install.log`. Then this waits up to a minute for
//!   `/kleio/health`, records the version in `host-code/current`, and removes
//!   every copy but that one and the one before it. It reports each step to
//!   the webview: copying, starting, checking.

use std::ffi::OsString;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::JavaScriptChannelId;
use tauri::{AppHandle, Manager};

/// The host's three ports, as `install-mini.sh` sets them: its API (and
/// `/kleio/health`), site previews and the link listener.
const HOST_PORT: u16 = 8443;
const PORTS: [u16; 3] = [HOST_PORT, 8444, 8445];
/// How long the jobs get to answer `/kleio/health` with the engine up.
const HEALTH_WAIT: Duration = Duration::from_secs(60);
/// The installer's PATH: the system's tools only.
const INSTALL_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// What kind of Mac this is, for the picker's words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MacKind {
    Laptop,
    Desktop,
    Unknown,
}

/// `pmset -g batt`'s output (None when it couldn't run) → the kind of Mac.
pub fn mac_kind(batt: Option<&str>) -> MacKind {
    let Some(batt) = batt else {
        return MacKind::Unknown;
    };
    if batt.lines().any(is_internal_battery) {
        MacKind::Laptop
    } else if batt.contains("Now drawing from") {
        MacKind::Desktop
    } else {
        MacKind::Unknown
    }
}

/// ` -InternalBattery-0 (id=…)`: the Mac's own battery, not a UPS.
fn is_internal_battery(line: &str) -> bool {
    line.trim_start()
        .strip_prefix("-InternalBattery-")
        .and_then(|rest| rest.chars().next())
        .is_some_and(|c| c.is_ascii_digit())
}

/// Laptop, desktop or unknown (`pmset -g batt`), off the main thread.
#[tauri::command]
pub async fn kleio_this_mac_kind() -> MacKind {
    let batt = tauri::async_runtime::spawn_blocking(|| {
        Command::new("/usr/bin/pmset")
            .args(["-g", "batt"])
            .env_clear()
            .stdin(Stdio::null())
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
    .ok()
    .flatten();
    mac_kind(batt.as_deref())
}

fn kleio_support(home: &Path) -> PathBuf {
    home.join("Library/Application Support/Kleio")
}

/// Where each version of the installed host's code goes.
pub fn host_code_root(home: &Path) -> PathBuf {
    kleio_support(home).join("host-code")
}

/// The host's state folder (`src/paths.ts`): kept by every install.
fn host_state(home: &Path) -> PathBuf {
    kleio_support(home).join("host")
}

pub fn install_log(home: &Path) -> PathBuf {
    host_state(home).join("logs/install.log")
}

/// The bundled host's `VERSION` (`<app version>+<commit>`), checked as
/// `install-mini.sh` checks its folder's name: one plain name, never `.`,
/// `..`, `current` or a `.partial` copy.
pub fn checked_version(raw: &str) -> Result<String, String> {
    let version = raw.trim();
    let plain = !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'));
    if !plain || matches!(version, "." | ".." | "current") || version.ends_with(".partial") {
        return Err(format!(
            "This copy of Kleio carries a host with a version it can't use ({version:?})."
        ));
    }
    Ok(version.to_string())
}

/// The installer, exactly as it runs: `/bin/sh`, the script and the only
/// variables it gets.
#[derive(Debug, PartialEq, Eq)]
pub struct InstallCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub env: Vec<(&'static str, OsString)>,
}

impl InstallCommand {
    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .env_clear()
            .envs(self.env.iter().map(|(key, value)| (key, value)))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }
}

/// `install-mini.sh` in app mode, from `contents` (`Kleio.app/Contents`)
/// into `host-code/<version>`, with the copied `ggnode` as the jobs' node.
pub fn install_command(home: &Path, contents: &Path, version: &str) -> InstallCommand {
    let code = host_code_root(home).join(version);
    InstallCommand {
        program: PathBuf::from("/bin/sh"),
        args: vec![contents.join("Resources/host/install-mini.sh").into()],
        env: vec![
            ("HOME", home.into()),
            ("PATH", INSTALL_PATH.into()),
            ("KLEIO_HOST_MODE", "app".into()),
            ("KLEIO_APP_CONTENTS", contents.into()),
            ("KLEIO_NODE_BIN", code.join("bin/ggnode").into()),
            ("KLEIO_HOST_CODE", code.into()),
        ],
    }
}

/// Each step of the install, as it begins, for the webview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallStep {
    /// Copying the host out of the app.
    Copying,
    /// Starting its launchd jobs.
    Starting,
    /// Waiting for it to answer.
    Checking,
}

type StepFn = Arc<dyn Fn(InstallStep) + Send + Sync>;

/// Calls `each` with every line of `reader`, invalid UTF-8 and all.
fn each_line(reader: impl Read, mut each: impl FnMut(&str)) {
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    while matches!(reader.read_until(b'\n', &mut line), Ok(n) if n > 0) {
        each(String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n']));
        line.clear();
    }
}

/// Runs the installer, appending its output to `log`. Starting begins when
/// it says where the code is (`code: …`), which it does once the copy is done.
/// A failure is the installer's own words on stderr.
fn run_installer(command: &InstallCommand, log: &Path, step: &StepFn) -> Result<(), String> {
    step(InstallStep::Copying);
    let log_shown = log.display().to_string();
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| format!("Kleio couldn't write its install log ({log_shown}): {e}"))?;
    let file = Arc::new(Mutex::new(file));
    let write = |file: &Mutex<fs::File>, line: &str| {
        if let Ok(mut file) = file.lock() {
            let _ = writeln!(file, "{line}");
        }
    };
    write(&file, &format!("== install {}", super::commands::now_iso()));
    let mut child = command
        .command()
        .spawn()
        .map_err(|e| format!("Kleio couldn't start its installer: {e}"))?;
    let stdout = child.stdout.take();
    let errors = child.stderr.take().map(|stderr| {
        let file = Arc::clone(&file);
        std::thread::spawn(move || {
            let mut lines = Vec::new();
            each_line(stderr, |line| {
                write(&file, line);
                lines.push(line.to_string());
            });
            lines
        })
    });
    let mut started = false;
    if let Some(stdout) = stdout {
        each_line(stdout, |line| {
            write(&file, line);
            if !started && line.starts_with("code: ") {
                started = true;
                step(InstallStep::Starting);
            }
        });
    }
    let status = child.wait();
    let errors = errors
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => {
            write(&file, &format!("== failed ({status})"));
            Err(installer_failure(&errors, &log_shown))
        }
        Err(e) => Err(format!("Kleio's installer stopped unexpectedly: {e}")),
    }
}

/// The installer's own words, or where its log is when it said nothing.
fn installer_failure(errors: &[String], log: &str) -> String {
    let said: Vec<&str> = errors
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect();
    if said.is_empty() {
        format!("Kleio couldn't set up this Mac's host. What happened is in {log}.")
    } else {
        said.join(" ")
    }
}

/// What `/kleio/health` said.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Health {
    /// Nothing answered.
    NoAnswer,
    /// Something answered that isn't Kleio's host.
    NotKleio,
    /// The host answered; its engine isn't up yet.
    EngineDown,
    /// The host answered with its engine up.
    Ready,
}

fn health_from(status: u16, body: &str) -> Health {
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(v) if status == 200 && v["ok"] == true => {
            if v["sidecar"] == "up" {
                Health::Ready
            } else {
                Health::EngineDown
            }
        }
        _ => Health::NotKleio,
    }
}

/// Why the host didn't answer in time, in words a person can act on.
/// `busy` lists the host's ports something already holds.
fn health_failure(last: Health, busy: &[u16], log: &str) -> String {
    let ports = |ports: &[u16]| {
        let names: Vec<String> = ports.iter().map(u16::to_string).collect();
        match names.as_slice() {
            [one] => format!("port {one}"),
            [rest @ .., last] => format!("ports {} and {last}", rest.join(", ")),
            [] => String::new(),
        }
    };
    match last {
        Health::Ready => String::new(),
        Health::EngineDown => format!(
            "Kleio's host started, but its engine didn't within a minute. \
             Its logs are in {}.",
            Path::new(log)
                .parent()
                .map_or(log.into(), |dir| dir.display().to_string())
        ),
        Health::NotKleio => format!(
            "Another app on this Mac is using {}, which Kleio's host needs. \
             Quit it, then try again.",
            ports(&[HOST_PORT])
        ),
        Health::NoAnswer if !busy.is_empty() => format!(
            "Another app on this Mac is using {}, which Kleio's host needs. \
             Quit it, then try again.",
            ports(busy)
        ),
        Health::NoAnswer => {
            format!("Kleio's host didn't start within a minute. What happened is in {log}.")
        }
    }
}

/// The host's ports something already holds.
fn busy_ports() -> Vec<u16> {
    PORTS
        .into_iter()
        .filter(|port| TcpListener::bind(("127.0.0.1", *port)).is_err())
        .collect()
}

async fn probe_health(client: &reqwest::Client) -> Health {
    let url = format!("http://127.0.0.1:{HOST_PORT}/kleio/health");
    let Ok(response) = client.get(url).send().await else {
        return Health::NoAnswer;
    };
    let status = response.status().as_u16();
    match response.text().await {
        Ok(body) => health_from(status, &body),
        Err(_) => Health::NotKleio,
    }
}

/// Waits up to [`HEALTH_WAIT`] for the host to answer with its engine up.
async fn wait_healthy(log: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Kleio couldn't check its host: {e}"))?;
    let deadline = Instant::now() + HEALTH_WAIT;
    loop {
        let health = probe_health(&client).await;
        if health == Health::Ready {
            return Ok(());
        }
        if Instant::now() >= deadline {
            let busy = if health == Health::NoAnswer {
                busy_ports()
            } else {
                Vec::new()
            };
            return Err(health_failure(health, &busy, &log));
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

/// The code folders to remove once `current` moved from `previous`: all but
/// those two. Files, and names starting with `.`, aren't code folders.
pub fn to_remove(folders: &[String], current: &str, previous: Option<&str>) -> Vec<String> {
    folders
        .iter()
        .filter(|name| {
            name.as_str() != current
                && Some(name.as_str()) != previous
                && name.as_str() != "current"
                && !name.starts_with('.')
        })
        .cloned()
        .collect()
}

/// Records `version` as the one that answered, in `root/current`, then, if
/// that moved it, removes the older copies. A copy that can't be removed is
/// only logged: the next move tries again.
pub fn record_current(root: &Path, version: &str) -> io::Result<()> {
    let current = root.join("current");
    let previous = fs::read_to_string(&current)
        .ok()
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty());
    let staged = root.join(".current.tmp");
    fs::write(&staged, format!("{version}\n"))?;
    fs::rename(&staged, &current)?;
    if previous.as_deref() == Some(version) {
        return Ok(());
    }
    let folders: Vec<String> = fs::read_dir(root)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    for name in to_remove(&folders, version, previous.as_deref()) {
        match fs::remove_dir_all(root.join(&name)) {
            Ok(()) => log::info!("kleio-host-install: removed the host's old copy {name}"),
            Err(e) => log::warn!("kleio-host-install: couldn't remove the old copy {name}: {e}"),
        }
    }
    Ok(())
}

/// The whole install after its checks: the installer, then the health wait.
/// `wait` is the health wait, so tests can stand in for it.
async fn install_with<F, W>(
    command: InstallCommand,
    log: PathBuf,
    step: StepFn,
    wait: W,
) -> Result<(), String>
where
    W: FnOnce(String) -> F,
    F: std::future::Future<Output = Result<(), String>>,
{
    let shown = log.display().to_string();
    let running = Arc::clone(&step);
    tauri::async_runtime::spawn_blocking(move || run_installer(&command, &log, &running))
        .await
        .map_err(|e| format!("Kleio's installer stopped unexpectedly: {e}"))??;
    step(InstallStep::Checking);
    wait(shown).await
}

/// One install at a time.
static INSTALLING: AtomicBool = AtomicBool::new(false);

struct Installing;

impl Installing {
    fn take() -> Result<Self, String> {
        INSTALLING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "Kleio is already setting up this Mac's host.".to_string())
    }
}

impl Drop for Installing {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::Release);
    }
}

/// The app's `Contents` folder, when it carries a host.
fn app_contents(app: &AppHandle) -> Result<PathBuf, String> {
    let missing =
        || "This copy of Kleio can't set up a host: it was built without one.".to_string();
    let resources = app.path().resource_dir().map_err(|_| missing())?;
    let contents = resources
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(missing)?;
    if contents.join("Resources/host/install-mini.sh").is_file() {
        Ok(contents)
    } else {
        Err(missing())
    }
}

/// What `kleio_host_install` ends with.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInstalled {
    /// The version now running, as `host-code/current` records it.
    pub version: String,
}

/// Installs (or reinstalls) this Mac's host from the one the app carries,
/// and waits until it answers with its engine up. It tells `on_step` each
/// step as it begins, if the webview gave a channel. Its errors say what
/// went wrong in words a person can act on.
#[tauri::command]
pub async fn kleio_host_install(
    app: AppHandle,
    webview: tauri::Webview,
    on_step: Option<JavaScriptChannelId>,
) -> Result<HostInstalled, String> {
    let _installing = Installing::take()?;
    let contents = app_contents(&app)?;
    let version = checked_version(
        &fs::read_to_string(contents.join("Resources/host/VERSION")).unwrap_or_default(),
    )?;
    let home = crate::home_dir();
    let log = install_log(&home);
    if let Some(dir) = log.parent() {
        fs::create_dir_all(dir).map_err(|e| {
            format!(
                "Kleio couldn't make the host's folder ({}): {e}",
                dir.display()
            )
        })?;
    }
    let steps = on_step.map(|id| id.channel_on::<_, InstallStep>(webview));
    let step: StepFn = Arc::new(move |step| {
        log::info!("kleio-host-install: {step:?}");
        if let Some(steps) = &steps {
            // The webview may have gone: the install carries on regardless.
            let _ = steps.send(step);
        }
    });
    log::info!("kleio-host-install: installing {version}");
    install_with(
        install_command(&home, &contents, &version),
        log,
        step,
        wait_healthy,
    )
    .await?;
    record_current(&host_code_root(&home), &version)
        .map_err(|e| format!("Kleio's host is running, but Kleio couldn't record it: {e}"))?;
    log::info!("kleio-host-install: {version} answered");
    Ok(HostInstalled { version })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const MACBOOK: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/kleio-host/test/fixtures/always-on/macbook-batt.txt"
    ));
    const MINI: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/kleio-host/test/fixtures/always-on/mini-batt.txt"
    ));
    const DESKTOP_WITH_UPS: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/kleio-host/test/fixtures/always-on/built-desktop-ups-batt.txt"
    ));

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kleio-host-install-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_mac_with_its_own_battery_is_a_laptop() {
        assert_eq!(mac_kind(Some(MACBOOK)), MacKind::Laptop);
    }

    #[test]
    fn a_mac_without_one_is_a_desktop_even_with_a_ups() {
        assert_eq!(mac_kind(Some(MINI)), MacKind::Desktop);
        assert_eq!(mac_kind(Some(DESKTOP_WITH_UPS)), MacKind::Desktop);
    }

    #[test]
    fn no_or_odd_pmset_output_is_unknown() {
        assert_eq!(mac_kind(None), MacKind::Unknown);
        assert_eq!(mac_kind(Some("")), MacKind::Unknown);
        assert_eq!(mac_kind(Some("pmset: unknown option")), MacKind::Unknown);
        assert_eq!(
            mac_kind(Some(" -InternalBattery-x (id=1)")),
            MacKind::Unknown
        );
        assert_eq!(
            serde_json::to_string(&MacKind::Laptop).unwrap(),
            "\"laptop\""
        );
    }

    #[test]
    fn the_installer_is_sh_and_the_script_with_only_its_variables() {
        let home = Path::new("/Users/finn");
        let contents = Path::new("/Applications/Kleio.app/Contents");
        let code = "/Users/finn/Library/Application Support/Kleio/host-code/2.2.0+3f10e6b3";

        let command = install_command(home, contents, "2.2.0+3f10e6b3");

        assert_eq!(
            command,
            InstallCommand {
                program: PathBuf::from("/bin/sh"),
                args: vec![
                    "/Applications/Kleio.app/Contents/Resources/host/install-mini.sh".into()
                ],
                env: vec![
                    ("HOME", "/Users/finn".into()),
                    ("PATH", "/usr/bin:/bin:/usr/sbin:/sbin".into()),
                    ("KLEIO_HOST_MODE", "app".into()),
                    (
                        "KLEIO_APP_CONTENTS",
                        "/Applications/Kleio.app/Contents".into()
                    ),
                    ("KLEIO_NODE_BIN", format!("{code}/bin/ggnode").into()),
                    ("KLEIO_HOST_CODE", code.into()),
                ],
            }
        );
    }

    #[test]
    fn the_installer_gets_none_of_the_apps_environment() {
        let dir = temp_dir("env");
        let script = dir.join("env.sh");
        fs::write(&script, "env\n").unwrap();
        let command = InstallCommand {
            program: PathBuf::from("/bin/sh"),
            args: vec![script.into()],
            env: vec![("KLEIO_HOST_MODE", "app".into())],
        };
        let log = dir.join("install.log");
        let step: StepFn = Arc::new(|_| {});

        run_installer(&command, &log, &step).unwrap();

        let text = fs::read_to_string(&log).unwrap();
        assert!(text.contains("KLEIO_HOST_MODE=app"), "{text}");
        // The test process has HOME (and, under cargo, CARGO_*); the installer mustn't.
        assert!(!text.lines().any(|l| l.starts_with("HOME=")), "{text}");
        assert!(!text.lines().any(|l| l.starts_with("CARGO")), "{text}");
        fs::remove_dir_all(dir).unwrap();
    }

    fn fake_installer(dir: &Path, body: &str) -> InstallCommand {
        let script = dir.join("install.sh");
        fs::write(&script, body).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o644)).unwrap();
        InstallCommand {
            program: PathBuf::from("/bin/sh"),
            args: vec![script.into()],
            env: Vec::new(),
        }
    }

    fn recorded() -> (StepFn, Arc<Mutex<Vec<InstallStep>>>) {
        let steps = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&steps);
        (Arc::new(move |step| seen.lock().unwrap().push(step)), steps)
    }

    #[test]
    fn steps_go_copying_starting_checking_and_the_output_goes_to_the_log() {
        let dir = temp_dir("steps");
        let command = fake_installer(
            &dir,
            "echo 'code: /x (copied from /y)'\necho 'kleio-host installed.'\necho 'a warning' >&2\n",
        );
        let log = dir.join("install.log");
        let (step, steps) = recorded();

        let result =
            tauri::async_runtime::block_on(install_with(command, log.clone(), step, |_| async {
                Ok(())
            }));

        assert_eq!(result, Ok(()));
        assert_eq!(
            *steps.lock().unwrap(),
            [
                InstallStep::Copying,
                InstallStep::Starting,
                InstallStep::Checking
            ]
        );
        let text = fs::read_to_string(&log).unwrap();
        assert!(text.starts_with("== install "), "{text}");
        for line in [
            "code: /x (copied from /y)",
            "kleio-host installed.",
            "a warning",
        ] {
            assert!(text.contains(line), "{text}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_failed_install_stops_at_its_step_with_the_installers_words() {
        let dir = temp_dir("fails");
        let command = fake_installer(
            &dir,
            "echo 'This Mac already runs a Kleio host.' >&2\necho 'Nothing was changed.' >&2\nexit 1\n",
        );
        let (step, steps) = recorded();
        let waited = Arc::new(AtomicBool::new(false));
        let waited_too = Arc::clone(&waited);

        let result = tauri::async_runtime::block_on(install_with(
            command,
            dir.join("install.log"),
            step,
            move |_| async move {
                waited_too.store(true, Ordering::SeqCst);
                Ok(())
            },
        ));

        assert_eq!(
            result,
            Err("This Mac already runs a Kleio host. Nothing was changed.".to_string())
        );
        assert_eq!(*steps.lock().unwrap(), [InstallStep::Copying]);
        assert!(!waited.load(Ordering::SeqCst));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_installer_that_says_nothing_points_at_its_log() {
        assert_eq!(
            installer_failure(&[String::new()], "/l/install.log"),
            "Kleio couldn't set up this Mac's host. What happened is in /l/install.log."
        );
    }

    #[test]
    fn steps_serialize_as_words() {
        assert_eq!(
            serde_json::to_string(&InstallStep::Copying).unwrap(),
            "\"copying\""
        );
        assert_eq!(
            serde_json::to_string(&InstallStep::Starting).unwrap(),
            "\"starting\""
        );
        assert_eq!(
            serde_json::to_string(&InstallStep::Checking).unwrap(),
            "\"checking\""
        );
    }

    #[test]
    fn health_is_ready_only_with_the_engine_up() {
        assert_eq!(
            health_from(200, r#"{"ok":true,"sidecar":"up"}"#),
            Health::Ready
        );
        assert_eq!(
            health_from(200, r#"{"ok":true,"sidecar":"down"}"#),
            Health::EngineDown
        );
        assert_eq!(
            health_from(200, r#"{"ok":true,"sidecar":"stale"}"#),
            Health::EngineDown
        );
        assert_eq!(health_from(200, "<html>hello</html>"), Health::NotKleio);
        assert_eq!(
            health_from(404, r#"{"ok":true,"sidecar":"up"}"#),
            Health::NotKleio
        );
    }

    #[test]
    fn a_host_that_doesnt_answer_names_the_port_in_the_way() {
        let log = "/h/logs/install.log";
        assert_eq!(
            health_failure(Health::NotKleio, &[], log),
            "Another app on this Mac is using port 8443, which Kleio's host needs. Quit it, then try again."
        );
        assert_eq!(
            health_failure(Health::NoAnswer, &[8444], log),
            "Another app on this Mac is using port 8444, which Kleio's host needs. Quit it, then try again."
        );
        assert_eq!(
            health_failure(Health::NoAnswer, &[8443, 8444, 8445], log),
            "Another app on this Mac is using ports 8443, 8444 and 8445, which Kleio's host needs. Quit it, then try again."
        );
        assert_eq!(
            health_failure(Health::NoAnswer, &[], log),
            "Kleio's host didn't start within a minute. What happened is in /h/logs/install.log."
        );
        assert_eq!(
            health_failure(Health::EngineDown, &[], log),
            "Kleio's host started, but its engine didn't within a minute. Its logs are in /h/logs."
        );
    }

    #[test]
    fn the_version_is_one_plain_name() {
        assert_eq!(
            checked_version("2.2.0+3f10e6b3\n"),
            Ok("2.2.0+3f10e6b3".into())
        );
        for bad in [
            "",
            "..",
            ".",
            "current",
            "2.2.0.partial",
            "a/b",
            "2.2.0 x",
            "$(x)",
        ] {
            assert!(checked_version(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn only_the_current_copy_and_the_one_before_it_stay() {
        let names: Vec<String> = ["1", "2", "3", "4.partial", ".x", "current"]
            .map(String::from)
            .to_vec();
        assert_eq!(to_remove(&names, "3", Some("2")), ["1", "4.partial"]);
        assert_eq!(to_remove(&names, "3", None), ["1", "2", "4.partial"]);
    }

    #[test]
    fn recording_a_new_version_removes_the_older_copies() {
        let root = temp_dir("current");
        let copy = |name: &str| fs::create_dir_all(root.join(name).join("dist")).unwrap();

        copy("1");
        record_current(&root, "1").unwrap();
        copy("2");
        record_current(&root, "2").unwrap();
        // The same version again moves nothing, so nothing goes.
        record_current(&root, "2").unwrap();
        assert!(root.join("1").is_dir());
        // A copy that never finished, and a newer one.
        copy("3.partial");
        copy("3");
        record_current(&root, "3").unwrap();

        assert_eq!(fs::read_to_string(root.join("current")).unwrap(), "3\n");
        let mut left: Vec<String> = fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, ["2", "3", "current"]);
        fs::remove_dir_all(root).unwrap();
    }
}
