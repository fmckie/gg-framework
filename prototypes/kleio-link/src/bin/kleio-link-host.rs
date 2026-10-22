//! `kleio-link-host`, feature `host`: the connection prototype's forwarder,
//! which runs next to kleio-host, and the commands that go with it
//! (`.gg/plans/kleio-connection-prototype.md`). Prototype only.

use std::fs;
use std::io::{self, IsTerminal, Write};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use iroh::SecretKey;
use kleio_link::endpoint::{bind_client, Mode};
use kleio_link::forward::Forward;
use kleio_link::host::{self, Config, HostError, StateDir};
use kleio_link::link::{host_addr, Link};
use kleio_link::pair::pair;
use kleio_link::ticket::{check_relay, Ticket, MAX_TICKET_BYTES};
use qrcode::render::unicode::Dense1x2;
use qrcode::{EcLevel, QrCode};
use tracing::{info, Level};
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

const USAGE: &str = "\
kleio-link-host: the Kleio link prototype's forwarder, run next to kleio-host.

usage:
  kleio-link-host serve --upstream 127.0.0.1:8443 [--relay <url>]
      Forward paired devices to kleio-host at --upstream, and pair new ones.
      Without --relay it uses n0's relays and logs the one it's reached
      through; pass that one as --relay to pin it.
  kleio-link-host qr --code <code>
      A pairing ticket for a code from `kleio-host pair`: the ticket on
      stdout, its QR code on stderr. Run serve first, so the host has a relay.
  kleio-link-host id
      This host's key.
  kleio-link-host client --ticket <file> --listen 127.0.0.1:<port> [--pair [--label <name>]]
      A test client with a fresh key, forwarding http://127.0.0.1:<port> to
      the host in the ticket. --pair pairs first, with the ticket's code, and
      saves the pairing, device token included, in the state folder. Without
      --pair it's the unpaired-key probe.

State: ~/Library/Application Support/Kleio/link-proto/ (0700). Logs go to
stderr; RUST_LOG takes target=level pairs, such as kleio_link=debug.
";

/// The label `client --pair` gives the host when `--label` is left out.
const DEFAULT_LABEL: &str = "kleio-link-host client";

/// Options that take no value.
const SWITCHES: &[&str] = &["--pair"];

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Serve(Config),
    Qr {
        code: String,
    },
    Id,
    Client {
        ticket: PathBuf,
        port: u16,
        /// The label to pair with, or `None` not to pair.
        pair: Option<String>,
    },
    Help,
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
        Command::Serve(config) => host::serve(&StateDir::open_default()?, config).await,
        Command::Qr { code } => qr(&StateDir::open_default()?, &code),
        Command::Id => {
            let key = StateDir::open_default()?.secret_key()?.public();
            println!("{key}");
            Ok(())
        }
        Command::Client { ticket, port, pair } => client(&ticket, port, pair).await,
        Command::Help => Ok(()),
    }
}

/// Prints a ticket for `code`: the JSON on stdout, the QR code on stderr.
fn qr(state: &StateDir, code: &str) -> Result<(), HostError> {
    let relay = state.relay()?.ok_or_else(|| {
        HostError::new(
            "No relay recorded yet: run `kleio-link-host serve` first, and it records the relay the host is reached through.",
        )
    })?;
    let ticket = Ticket::new(state.secret_key()?.public(), &relay, code)
        .map_err(|err| HostError::new(err.to_string()))?;
    let json = ticket.to_json();
    let picture = QrCode::with_error_correction_level(json.as_bytes(), EcLevel::M)
        .map_err(|err| HostError::new(format!("Can't draw the QR code: {err}")))?
        .render::<Dense1x2>()
        .build();
    // Black on white whatever the terminal's colours, so a camera reads it.
    let (start, end) = if io::stderr().is_terminal() {
        ("\x1b[38;5;16;48;5;231m", "\x1b[0m")
    } else {
        ("", "")
    };
    let mut shown = io::stderr().lock();
    let drawn = picture
        .lines()
        .try_for_each(|line| writeln!(shown, "{start}{line}{end}"))
        .and_then(|()| {
            writeln!(
                shown,
                "\nOn the phone, check the confirm step shows host key {}…, relay {} and code {}.",
                ticket.key_prefix(),
                ticket.relay_host(),
                ticket.code()
            )
        });
    drawn.map_err(|err| HostError::new(format!("Can't show the QR code: {err}")))?;
    println!("{json}");
    Ok(())
}

/// The test client: a fresh key, pairing first if `pair_label` is given, then
/// forwarding `127.0.0.1:<port>` to the host in the ticket.
async fn client(ticket: &Path, port: u16, pair_label: Option<String>) -> Result<(), HostError> {
    let ticket = read_ticket(ticket)?;
    let endpoint = bind_client(SecretKey::generate(), Mode::Auto)
        .await
        .map_err(|err| HostError::new(format!("Can't start the endpoint: {err}")))?;
    info!(
        "client key {} (fresh, kept only while this runs)",
        endpoint.id().fmt_short()
    );
    match pair_label {
        Some(label) => {
            let payload = pair(&endpoint, &ticket, &label)
                .await
                .map_err(|err| HostError::new(err.to_string()))?;
            let saved = StateDir::open_default()?.save_client_pairing(&payload)?;
            info!(
                "paired; the pairing, device token included, is in {}",
                saved.display()
            );
        }
        None => info!("not pairing, so the host turns this key away: the unpaired-key probe"),
    }
    let link = Link::new(endpoint, host_addr(ticket.key(), ticket.relay()));
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
            let upstream = upstream(&flags.required("--upstream")?)?;
            let relay = match flags.value("--relay")? {
                Some(relay) => Some(check_relay(&relay).map_err(|_| {
                    format!("--relay {relay:?} isn't https://<host>/ with nothing else")
                })?),
                None => None,
            };
            Command::Serve(Config { upstream, relay })
        }
        "qr" => Command::Qr {
            code: flags.required("--code")?,
        },
        "id" => Command::Id,
        "client" => {
            let ticket = PathBuf::from(flags.required("--ticket")?);
            let port = listen_port(&flags.required("--listen")?)?;
            let pairing = flags.switch("--pair")?;
            let pair = match (pairing, flags.value("--label")?) {
                (true, label) => Some(label.unwrap_or_else(|| DEFAULT_LABEL.to_string())),
                (false, None) => None,
                (false, Some(_)) => return Err("--label goes with --pair".into()),
            };
            Command::Client { ticket, port, pair }
        }
        "help" | "-h" | "--help" => Command::Help,
        other => return Err(format!("unknown command {other:?}")),
    };
    flags.done()?;
    Ok(command)
}

/// kleio-host's address: on this machine, as kleio-host listens.
fn upstream(text: &str) -> Result<SocketAddr, String> {
    let addr: SocketAddr = text
        .parse()
        .map_err(|_| format!("--upstream {text:?} isn't an address, such as 127.0.0.1:8443"))?;
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
    use iroh::RelayUrl;

    use super::*;

    fn parse_line(line: &str) -> Result<Command, String> {
        let args: Vec<String> = line.split_whitespace().map(str::to_owned).collect();
        parse(&args)
    }

    fn client(port: u16, pair: Option<&str>) -> Command {
        Command::Client {
            ticket: "t.json".into(),
            port,
            pair: pair.map(str::to_owned),
        }
    }

    #[test]
    fn reads_each_command() {
        let upstream: SocketAddr = "127.0.0.1:8443".parse().expect("an address");
        let relay: RelayUrl = "https://euc1-1.relay.n0.iroh.link./"
            .parse()
            .expect("a URL");
        assert_eq!(
            parse_line("serve --upstream 127.0.0.1:8443"),
            Ok(Command::Serve(Config {
                upstream,
                relay: None
            }))
        );
        assert_eq!(
            parse_line(
                "serve --relay=https://euc1-1.relay.n0.iroh.link./ --upstream 127.0.0.1:8443"
            ),
            Ok(Command::Serve(Config {
                upstream,
                relay: Some(relay)
            }))
        );
        assert_eq!(
            parse_line("qr --code ABC-DEF"),
            Ok(Command::Qr {
                code: "ABC-DEF".into()
            })
        );
        assert_eq!(parse_line("id"), Ok(Command::Id));
        assert_eq!(
            parse_line("client --ticket t.json --listen 127.0.0.1:47821"),
            Ok(client(47821, None))
        );
        assert_eq!(
            parse_line("client --ticket t.json --listen 127.0.0.1:47821 --pair"),
            Ok(client(47821, Some(DEFAULT_LABEL)))
        );
        assert_eq!(
            parse_line("client --pair --label laptop --ticket t.json --listen 127.0.0.1:0"),
            Ok(client(0, Some("laptop")))
        );
        assert_eq!(parse_line("--help"), Ok(Command::Help));
    }

    #[test]
    fn refuses_what_it_cant_use() {
        for line in [
            "",
            "launch",
            "serve",
            "serve --upstream 192.168.1.10:8443",
            "serve --upstream mini:8443",
            "serve --upstream 127.0.0.1:8443 --relay http://euc1-1.relay.n0.iroh.link./",
            "serve --upstream 127.0.0.1:8443 --upstream 127.0.0.1:8444",
            "serve --upstream 127.0.0.1:8443 --verbose",
            "serve --upstream",
            "qr",
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
}
