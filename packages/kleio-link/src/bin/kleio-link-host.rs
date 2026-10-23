//! `kleio-link-host`, feature `host`: Kleio's link on the host, which runs
//! next to kleio-host, and the commands that go with it
//! (docs/adr/0002-kleio-link-replaces-tailscale.md).

use std::fs;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use iroh::{RelayUrl, SecretKey};
use kleio_link::endpoint::{bind_client, EndpointOptions, Mode, RelayTrust, MAX_RELAY_CA_BYTES};
use kleio_link::forward::Forward;
use kleio_link::host::{self, save_private_json, Config, HostDir, HostError, DEFAULT_UPSTREAM};
use kleio_link::link::{Link, Route};
use kleio_link::pair::pair;
use kleio_link::probe::HttpsProbe;
use kleio_link::relays::check_relay_url;
use kleio_link::ticket::{Ticket, MAX_TICKET_BYTES};
use qrcode::render::unicode::Dense1x2;
use qrcode::{EcLevel, QrCode};
use tracing::{info, Level};
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

const USAGE: &str = "\
kleio-link-host: Kleio's link on the host, run next to kleio-host.

usage:
  kleio-link-host serve [--state-dir <dir>] [--upstream 127.0.0.1:8445] [--relay <url>]
                        [--relay-ca <file>] [--relay-only]
      Forward paired devices to kleio-host's link listener at --upstream,
      and pair new ones. The key, the secret, the allow-list and the relay
      list are kleio-host's, in --state-dir (kleio-host's own state folder
      by default). It's on one relay at a time from the list, moving after
      15 s without it and back after 5 minutes; --relay pins one for good.
      --relay-ca also takes relays whose certificates chain to one in <file>
      (PEM), beside the roots built in: for a relay with an authority of its
      own, such as a test's. --relay-only binds no UDP socket, so every
      connection goes through a relay (for tests).
  kleio-link-host qr [--color]
      Draws the pairing ticket on stdin as a QR code on stdout, for
      `kleio-host pair`. --color draws it black on white, whatever the
      terminal's colours, so a camera reads it.
  kleio-link-host id [--state-dir <dir>]
      This host's key.
  kleio-link-host client --ticket <file> --listen 127.0.0.1:<port> [--pair [--label <name>] [--save <file>]]
                         [--relay-ca <file>] [--relay-only]
      A test client with a fresh key, forwarding http://127.0.0.1:<port> to
      the host in the ticket. --pair pairs first, with the ticket's code;
      --save keeps the pairing, device token included, in <file> (0600, so
      not on Windows). Without --pair it's the unpaired-key probe.
      --relay-ca and --relay-only as for serve.

kleio-host's state folder: $KLEIO_HOST_HOME, else ~/Library/Application
Support/Kleio/host on macOS and $XDG_STATE_HOME/kleio/host on Linux. Logs go
to stderr; RUST_LOG takes target=level pairs, such as kleio_link=debug.
";

/// The label `client --pair` gives the host when `--label` is left out.
const DEFAULT_LABEL: &str = "kleio-link-host client";

/// Options that take no value.
const SWITCHES: &[&str] = &["--pair", "--color", "--relay-only"];

/// `--relay-ca` and `--relay-only`, for the endpoint's options.
#[derive(Debug, Default, PartialEq, Eq)]
struct Reach {
    /// A PEM file of certificates a relay's may also chain to.
    relay_ca: Option<PathBuf>,
    mode: Mode,
}

impl Reach {
    fn read(flags: &mut Flags) -> Result<Self, String> {
        let relay_ca = flags.value("--relay-ca")?.map(PathBuf::from);
        let mode = if flags.switch("--relay-only")? {
            Mode::RelayOnly
        } else {
            Mode::Auto
        };
        Ok(Self { relay_ca, mode })
    }

    /// The endpoint's options: the mode, and `--relay-ca`'s certificates.
    fn options(&self) -> Result<EndpointOptions, HostError> {
        Ok(EndpointOptions {
            mode: self.mode,
            trust: self.trust()?,
        })
    }

    /// The roots built in, and `--relay-ca`'s.
    fn trust(&self) -> Result<RelayTrust, HostError> {
        let Some(path) = &self.relay_ca else {
            return Ok(RelayTrust::default());
        };
        let at = |why: String| HostError::new(format!("--relay-ca {}: {why}", path.display()));
        let mut pem = Vec::new();
        fs::File::open(path)
            .and_then(|file| {
                file.take(MAX_RELAY_CA_BYTES as u64 + 1)
                    .read_to_end(&mut pem)
            })
            .map_err(|err| at(err.to_string()))?;
        RelayTrust::from_pem(&pem).map_err(at)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Serve {
        /// kleio-host's state folder, or `None` for its default.
        state_dir: Option<PathBuf>,
        upstream: SocketAddr,
        relay: Option<RelayUrl>,
        reach: Reach,
    },
    Qr {
        color: bool,
    },
    Id {
        state_dir: Option<PathBuf>,
    },
    Client {
        ticket: PathBuf,
        port: u16,
        /// The label to pair with, or `None` not to pair.
        pair: Option<String>,
        /// Where `--pair` keeps the pairing.
        save: Option<PathBuf>,
        reach: Reach,
    },
    Help,
}

/// kleio-host's state folder: `dir`, or kleio-host's default.
fn host_dir(dir: Option<PathBuf>) -> Result<HostDir, HostError> {
    Ok(HostDir::new(match dir {
        Some(dir) => dir,
        None => HostDir::default_home()?,
    }))
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Result<Vec<String>, _> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.into_string())
        .collect();
    let parsed = match args {
        Ok(args) => parse(&args),
        Err(_) => Err("arguments must be UTF-8".to_string()),
    };
    let command = match parsed {
        Ok(Command::Help) => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Ok(command) => command,
        Err(err) => {
            eprint!("kleio-link-host: {err}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    init_log();
    match run(command).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("kleio-link-host: {err}");
            ExitCode::FAILURE
        }
    }
}

async fn run(command: Command) -> Result<(), HostError> {
    match command {
        Command::Serve {
            state_dir,
            upstream,
            relay,
            reach,
        } => {
            let home = host_dir(state_dir)?.path().to_path_buf();
            host::serve(Config {
                home,
                upstream,
                relay,
                options: reach.options()?,
            })
            .await
        }
        Command::Qr { color } => qr(color),
        Command::Id { state_dir } => {
            let key = host_dir(state_dir)?.secret_key()?.public();
            println!("{key}");
            Ok(())
        }
        Command::Client {
            ticket,
            port,
            pair,
            save,
            reach,
        } => client(&ticket, port, pair, save, &reach).await,
        Command::Help => Ok(()),
    }
}

/// Draws the pairing ticket on stdin, which `kleio-host pair` makes, as a QR
/// code on stdout. The ticket comes on stdin rather than as an argument,
/// because other users can read a program's arguments. kleio-host checked
/// it; this only draws it.
fn qr(color: bool) -> Result<(), HostError> {
    let ticket = read_stdin_ticket(io::stdin().lock())?;
    let picture = QrCode::with_error_correction_level(ticket.as_bytes(), EcLevel::M)
        .map_err(|err| HostError::new(format!("Can't draw the QR code: {err}")))?
        .render::<Dense1x2>()
        .build();
    // Black on white whatever the terminal's colours, so a camera reads it.
    let (start, end) = if color {
        ("\x1b[38;5;16;48;5;231m", "\x1b[0m")
    } else {
        ("", "")
    };
    let mut out = io::stdout().lock();
    picture
        .lines()
        .try_for_each(|line| writeln!(out, "{start}{line}{end}"))
        .map_err(|err| HostError::new(format!("Can't show the QR code: {err}")))
}

/// The ticket `input` holds, trimmed: at most [`MAX_TICKET_BYTES`], and not
/// empty.
fn read_stdin_ticket(input: impl Read) -> Result<String, HostError> {
    let mut text = String::new();
    input
        .take(MAX_TICKET_BYTES as u64 + 1)
        .read_to_string(&mut text)
        .map_err(|err| HostError::new(format!("Can't read the ticket on stdin: {err}")))?;
    if text.len() > MAX_TICKET_BYTES {
        return Err(HostError::new(
            "The text on stdin is too long to be a pairing ticket.",
        ));
    }
    let ticket = text.trim();
    if ticket.is_empty() {
        return Err(HostError::new(
            "No pairing ticket on stdin: `kleio-host pair` gives one.",
        ));
    }
    Ok(ticket.to_string())
}

/// The test client: a fresh key, pairing first if `pair_label` is given, then
/// forwarding `127.0.0.1:<port>` to the host in the ticket.
async fn client(
    ticket: &Path,
    port: u16,
    pair_label: Option<String>,
    save: Option<PathBuf>,
    reach: &Reach,
) -> Result<(), HostError> {
    let ticket = read_ticket(ticket)?;
    let options = reach.options()?;
    let key = SecretKey::generate();
    info!(
        "client key {} (fresh, kept only while this runs)",
        key.public().fmt_short()
    );
    match pair_label {
        Some(label) => {
            let probe = HttpsProbe::new(&options.trust).map_err(HostError::new)?;
            let stage = |stage: kleio_link::pair::PairStage| info!("{}", stage.text());
            let payload = pair(key.clone(), &ticket, &label, &options, &probe, stage)
                .await
                .map_err(|err| HostError::new(err.to_string()))?;
            match save {
                Some(path) => {
                    save_private_json(&path, &payload)?;
                    info!(
                        "paired; the pairing, device token included, is in {}",
                        path.display()
                    );
                }
                None => info!("paired; the device token is kept only while this runs"),
            }
        }
        None => info!("not pairing, so the host turns this key away: the unpaired-key probe"),
    }
    let endpoint = bind_client(key, std::slice::from_ref(ticket.relay()), &options)
        .await
        .map_err(|err| HostError::new(format!("Can't start the endpoint: {err}")))?;
    let link = Link::new(endpoint, Route::from_ticket(&ticket));
    let forward = Forward::bind(port, link)
        .await
        .map_err(|err| HostError::new(format!("Can't listen on 127.0.0.1:{port}: {err}")))?;
    let listening = forward
        .local_addr()
        .map_err(|err| HostError::new(err.to_string()))?;
    info!(
        "forwarding http://{listening} to {} through {}",
        ticket.key().fmt_short(),
        ticket.relay()
    );
    forward.run().await;
    Ok(())
}

fn read_ticket(path: &Path) -> Result<Ticket, HostError> {
    let at = |err: io::Error| HostError::new(format!("{}: {err}", path.display()));
    if fs::metadata(path).map_err(at)?.len() > MAX_TICKET_BYTES as u64 {
        return Err(HostError::new(format!(
            "{}: too long to be a ticket",
            path.display()
        )));
    }
    let text = fs::read_to_string(path).map_err(at)?;
    text.parse::<Ticket>()
        .map_err(|err| HostError::new(format!("{}: {err}", path.display())))
}

/// The forwarder's log on stderr: kleio-link at info and everything else,
/// iroh's relay warnings included, at warn, unless `RUST_LOG` says otherwise.
fn init_log() {
    let default = || {
        Targets::new()
            .with_default(Level::WARN)
            .with_target("kleio_link", Level::INFO)
            .with_target("kleio_link_host", Level::INFO)
    };
    let filter = match std::env::var("RUST_LOG") {
        Ok(spec) => spec.parse::<Targets>().unwrap_or_else(|err| {
            eprintln!("kleio-link-host: ignoring RUST_LOG ({err})");
            default()
        }),
        Err(_) => default(),
    };
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_writer(io::stderr))
        .with(filter)
        .init();
}

fn parse(args: &[String]) -> Result<Command, String> {
    let Some((name, rest)) = args.split_first() else {
        return Err("no command given".into());
    };
    let mut flags = Flags::read(rest)?;
    let command = match name.as_str() {
        "serve" => {
            let state_dir = state_dir(flags.value("--state-dir")?)?;
            let upstream = match flags.value("--upstream")? {
                Some(text) => upstream(&text)?,
                None => DEFAULT_UPSTREAM,
            };
            let relay = match flags.value("--relay")? {
                Some(relay) => Some(check_relay_url(&relay).ok_or_else(|| {
                    format!("--relay {relay:?} isn't https://<host>[:<port>]/ with nothing else")
                })?),
                None => None,
            };
            Command::Serve {
                state_dir,
                upstream,
                relay,
                reach: Reach::read(&mut flags)?,
            }
        }
        "qr" => Command::Qr {
            color: flags.switch("--color")?,
        },
        "id" => Command::Id {
            state_dir: state_dir(flags.value("--state-dir")?)?,
        },
        "client" => {
            let ticket = PathBuf::from(flags.required("--ticket")?);
            let port = listen_port(&flags.required("--listen")?)?;
            let pairing = flags.switch("--pair")?;
            let label = flags.value("--label")?;
            let save = flags.value("--save")?.map(PathBuf::from);
            if !pairing && (label.is_some() || save.is_some()) {
                return Err("--label and --save go with --pair".into());
            }
            let pair = pairing.then(|| label.unwrap_or_else(|| DEFAULT_LABEL.to_string()));
            Command::Client {
                ticket,
                port,
                pair,
                save,
                reach: Reach::read(&mut flags)?,
            }
        }
        "help" | "-h" | "--help" => Command::Help,
        other => return Err(format!("unknown command {other:?}")),
    };
    flags.done()?;
    Ok(command)
}

/// `--state-dir`: an absolute path, so it's the folder kleio-host uses.
fn state_dir(text: Option<String>) -> Result<Option<PathBuf>, String> {
    match text.map(PathBuf::from) {
        Some(dir) if !dir.is_absolute() => Err(format!(
            "--state-dir {} isn't an absolute path",
            dir.display()
        )),
        dir => Ok(dir),
    }
}

/// kleio-host's link listener: on this machine, as kleio-host listens.
fn upstream(text: &str) -> Result<SocketAddr, String> {
    let addr: SocketAddr = text
        .parse()
        .map_err(|_| format!("--upstream {text:?} isn't an address, such as 127.0.0.1:8445"))?;
    if !addr.ip().is_loopback() {
        return Err(format!(
            "--upstream {text:?} isn't on this machine; kleio-host listens on 127.0.0.1"
        ));
    }
    Ok(addr)
}

/// The port of `127.0.0.1:<port>`: the client's forward listens on loopback
/// only.
fn listen_port(text: &str) -> Result<u16, String> {
    match text.parse::<SocketAddr>() {
        Ok(SocketAddr::V4(addr)) if *addr.ip() == Ipv4Addr::LOCALHOST => Ok(addr.port()),
        _ => Err(format!("--listen {text:?} isn't 127.0.0.1:<port>")),
    }
}

/// Options as `--name value`, `--name=value` or, for switches, `--name`.
struct Flags(Vec<(String, Option<String>)>);

impl Flags {
    fn read(args: &[String]) -> Result<Self, String> {
        let mut flags: Vec<(String, Option<String>)> = Vec::new();
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            if !arg.starts_with("--") {
                return Err(format!("unexpected {arg:?}"));
            }
            let (name, value) = match arg.split_once('=') {
                Some((name, value)) => (name.to_string(), Some(value.to_string())),
                None if SWITCHES.contains(&arg.as_str()) => (arg.clone(), None),
                None => {
                    let value = args.next().ok_or_else(|| format!("{arg} needs a value"))?;
                    (arg.clone(), Some(value.clone()))
                }
            };
            if flags.iter().any(|(seen, _)| *seen == name) {
                return Err(format!("{name} is given twice"));
            }
            flags.push((name, value));
        }
        Ok(Self(flags))
    }

    fn take(&mut self, name: &str) -> Option<Option<String>> {
        let at = self.0.iter().position(|(seen, _)| seen == name)?;
        Some(self.0.remove(at).1)
    }

    fn value(&mut self, name: &str) -> Result<Option<String>, String> {
        match self.take(name) {
            None => Ok(None),
            Some(Some(value)) => Ok(Some(value)),
            Some(None) => Err(format!("{name} needs a value")),
        }
    }

    fn required(&mut self, name: &str) -> Result<String, String> {
        self.value(name)?
            .ok_or_else(|| format!("{name} is required"))
    }

    fn switch(&mut self, name: &str) -> Result<bool, String> {
        match self.take(name) {
            None => Ok(false),
            Some(None) => Ok(true),
            Some(Some(_)) => Err(format!("{name} takes no value")),
        }
    }

    /// Any option left over is one the command doesn't take.
    fn done(self) -> Result<(), String> {
        match self.0.first() {
            Some((name, _)) => Err(format!("unknown option {name}")),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_line(line: &str) -> Result<Command, String> {
        let args: Vec<String> = line.split_whitespace().map(str::to_owned).collect();
        parse(&args)
    }

    fn client(port: u16, pair: Option<&str>, save: Option<&str>) -> Command {
        Command::Client {
            ticket: "t.json".into(),
            port,
            pair: pair.map(str::to_owned),
            save: save.map(PathBuf::from),
            reach: Reach::default(),
        }
    }

    fn serve(state_dir: Option<&str>, upstream: &str, relay: Option<&str>) -> Command {
        Command::Serve {
            state_dir: state_dir.map(PathBuf::from),
            upstream: upstream.parse().expect("an address"),
            relay: relay.map(|relay| relay.parse::<RelayUrl>().expect("a URL")),
            reach: Reach::default(),
        }
    }

    fn reach(relay_ca: Option<&str>, mode: Mode) -> Reach {
        Reach {
            relay_ca: relay_ca.map(PathBuf::from),
            mode,
        }
    }

    #[test]
    fn reads_each_command() {
        let n0 = "https://euc1-1.relay.n0.iroh.link./";
        assert_eq!(parse_line("serve"), Ok(serve(None, "127.0.0.1:8445", None)));
        assert_eq!(
            parse_line("serve --state-dir /srv/kleio/host --upstream 127.0.0.1:9445"),
            Ok(serve(Some("/srv/kleio/host"), "127.0.0.1:9445", None))
        );
        assert_eq!(
            parse_line(&format!("serve --relay={n0} --upstream [::1]:8445")),
            Ok(serve(None, "[::1]:8445", Some(n0)))
        );
        assert_eq!(parse_line("qr"), Ok(Command::Qr { color: false }));
        assert_eq!(parse_line("qr --color"), Ok(Command::Qr { color: true }));
        assert_eq!(parse_line("id"), Ok(Command::Id { state_dir: None }));
        assert_eq!(
            parse_line("id --state-dir /srv/kleio/host"),
            Ok(Command::Id {
                state_dir: Some("/srv/kleio/host".into())
            })
        );
        assert_eq!(
            parse_line("client --ticket t.json --listen 127.0.0.1:47821"),
            Ok(client(47821, None, None))
        );
        assert_eq!(
            parse_line("client --ticket t.json --listen 127.0.0.1:47821 --pair"),
            Ok(client(47821, Some(DEFAULT_LABEL), None))
        );
        assert_eq!(
            parse_line(
                "client --pair --label laptop --save /tmp/p.json --ticket t.json --listen 127.0.0.1:0"
            ),
            Ok(client(0, Some("laptop"), Some("/tmp/p.json")))
        );
        assert_eq!(parse_line("--help"), Ok(Command::Help));
    }

    #[test]
    fn reads_how_each_end_reaches_relays() {
        let Ok(Command::Serve { reach: got, .. }) =
            parse_line("serve --relay-ca /tmp/relay.pem --relay-only")
        else {
            panic!("serve");
        };
        assert_eq!(got, reach(Some("/tmp/relay.pem"), Mode::RelayOnly));
        let Ok(Command::Client { reach: got, .. }) =
            parse_line("client --ticket t.json --listen 127.0.0.1:0 --relay-ca=ca.pem")
        else {
            panic!("client");
        };
        assert_eq!(got, reach(Some("ca.pem"), Mode::Auto));
        for line in [
            "serve --relay-only=yes",
            "serve --relay-ca",
            "qr --relay-only",
            "id --relay-ca ca.pem",
        ] {
            assert!(parse_line(line).is_err(), "{line:?}");
        }
    }

    #[test]
    fn reads_relay_certificates_from_a_pem_file() {
        assert_eq!(Reach::default().trust().ok(), Some(RelayTrust::default()));
        let dir = std::env::temp_dir().join(format!("kleio-link-host-ca-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("made");
        let missing = reach(Some(&dir.join("none.pem").to_string_lossy()), Mode::Auto);
        assert!(missing.trust().is_err());
        let empty = dir.join("empty.pem");
        fs::write(&empty, "nothing here\n").expect("written");
        let err = reach(Some(&empty.to_string_lossy()), Mode::Auto)
            .trust()
            .expect_err("no certificate");
        assert!(err.to_string().starts_with("--relay-ca "), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_the_ticket_on_stdin_trimmed_and_refuses_none_or_too_much() {
        let ticket = r#"{"v":4,"type":"kleio-pair"}"#;
        assert_eq!(
            read_stdin_ticket(format!("{ticket}\n").as_bytes()).ok(),
            Some(ticket.to_string())
        );
        assert!(read_stdin_ticket(&b" \n"[..]).is_err());
        let long = "x".repeat(MAX_TICKET_BYTES + 1);
        assert!(read_stdin_ticket(long.as_bytes()).is_err());
        let longest = "x".repeat(MAX_TICKET_BYTES);
        assert_eq!(read_stdin_ticket(longest.as_bytes()).ok(), Some(longest));
    }

    #[test]
    fn refuses_what_it_cant_use() {
        for line in [
            "",
            "launch",
            "serve --upstream 192.168.1.10:8443",
            "serve --state-dir relative/host",
            "id --state-dir host",
            "client --ticket t.json --listen 127.0.0.1:47821 --save p.json",
            "serve --upstream mini:8443",
            "serve --upstream 127.0.0.1:8443 --relay http://euc1-1.relay.n0.iroh.link./",
            "serve --upstream 127.0.0.1:8443 --upstream 127.0.0.1:8444",
            "serve --upstream 127.0.0.1:8443 --verbose",
            "serve --upstream",
            "qr --code ABC-DEF",
            "qr --color=yes",
            "id extra",
            "client --ticket t.json",
            "client --ticket t.json --listen 0.0.0.0:47821",
            "client --ticket t.json --listen [::1]:47821",
            "client --ticket t.json --listen 127.0.0.1:47821 --label laptop",
            "client --ticket t.json --listen 127.0.0.1:47821 --pair=yes",
        ] {
            assert!(parse_line(line).is_err(), "{line:?}");
        }
    }

    /// contrib/kleio-link.service, the Linux user unit, runs a `serve` this
    /// takes: by default with kleio-host's state folder and link listener, and
    /// from where `kleio-host pair` looks for kleio-link-host.
    #[test]
    fn the_systemd_unit_runs_a_serve_it_takes() {
        let unit = include_str!("../../contrib/kleio-link.service");
        let home = "/home/kleio";
        let mut env = std::collections::BTreeMap::new();
        let mut exec = None;
        for line in unit.lines() {
            let line = line.replace("%h", home);
            if let Some(setting) = line.strip_prefix("Environment=") {
                let (name, value) = setting.split_once('=').expect("NAME=value");
                env.insert(name.to_string(), value.to_string());
            } else if let Some(command) = line.strip_prefix("ExecStart=") {
                assert!(exec.replace(command.to_string()).is_none(), "one ExecStart");
            }
        }
        let mut command = exec.expect("an ExecStart");
        for (name, value) in &env {
            command = command.replace(&format!("${{{name}}}"), value);
        }
        assert!(!command.contains('$'), "{command}");
        let (program, args) = command
            .split_once(' ')
            .expect("a program and its arguments");
        assert_eq!(program, "/home/kleio/kleio-host/bin/kleio-link-host");
        assert_eq!(
            parse_line(args),
            Ok(serve(
                Some("/home/kleio/.local/state/kleio/host"),
                "127.0.0.1:8445",
                None
            ))
        );
    }
}
