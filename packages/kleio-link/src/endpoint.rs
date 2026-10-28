//! The iroh endpoint both ends bind.
//!
//! - No address lookup, so nothing talks to n0's `dns.iroh.link`: the phone
//!   reaches the host through the relay its ticket names.
//! - No port mapping, so nothing asks the router to open a port. (The crate
//!   also leaves out iroh's `portmapper` feature.)
//! - Each end has one relay in its relay map, which is its home relay: the
//!   host the one it's pinned to (host/relays.rs), the phone the one it last
//!   reached the host through ([`switch_relay`]). So neither asks any other
//!   relay anything, not even its latency, and a host whose list leaves out
//!   n0's relays has nothing to do with n0. The host starts from the same
//!   [`builder`], and adds its ALPNs and gate hook.
//! - A relay's certificate must chain to the roots iroh has built in, or to
//!   one [`RelayTrust`] adds.
//!
//! [`EndpointOptions`] carries both settings an end can have: its [`Mode`]
//! and its [`RelayTrust`]. The app's are the defaults.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use iroh::endpoint::{presets, BindError, Builder, PortmapperConfig};
use iroh::tls::CaTlsConfig;
use iroh::{Endpoint, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey};
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::CertificateDer;

/// How long an end waits on a connection it hears nothing on before it drops
/// it: QUIC's idle timeout. Both ends take iroh's default transport
/// (`QuicTransportConfig::default`), the host with only its congestion
/// control changed (`host::transport`), and it keeps noq's 30 s
/// `max_idle_timeout` (RFC 9308 § 3.2). A connection runs on the smaller of
/// the two ends' values. A phone suspended for longer can't tell that the
/// host has dropped the connection. Tests check this against iroh's default,
/// and the host's.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// Whether an end may take a direct path: for tests and the `client` dev
/// tool, and `kleio-link-host serve --relay-only`. The app always takes
/// [`Mode::Auto`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    /// Through the relay at first, then direct once iroh finds a path.
    #[default]
    Auto,
    /// Through the relay only. The endpoint has no IP transports, so no
    /// direct path can open, and it binds no UDP socket.
    RelayOnly,
    /// As [`Mode::Auto`], with its UDP sockets on 127.0.0.1 and [::1] only:
    /// for tests, which need ends that have direct addresses while nothing
    /// leaves the machine (and the macOS firewall has nothing to ask).
    Loopback,
}

impl Mode {
    /// Whether the endpoint keeps its IP (UDP) transports, which a direct path
    /// needs.
    pub fn keeps_ip_transports(self) -> bool {
        match self {
            Self::Auto | Self::Loopback => true,
            Self::RelayOnly => false,
        }
    }
}

/// The most of a file of relay certificates read.
pub const MAX_RELAY_CA_BYTES: usize = 64 * 1024;

/// What a relay's certificate may chain to: the Mozilla roots iroh has built
/// in (webpki-roots), which n0's relays and any relay with a Let's Encrypt
/// certificate chain to, and any certificate added here. A relay whose
/// certificate comes from an authority of its own, such as a test's relay,
/// needs that authority's certificate added (`kleio-link-host serve
/// --relay-ca`). It's only about reaching the relay: a relay can't read the
/// link either way.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RelayTrust {
    extra: Vec<CertificateDer<'static>>,
}

impl RelayTrust {
    /// The built-in roots, and `roots` too.
    pub fn with_roots(roots: impl IntoIterator<Item = CertificateDer<'static>>) -> Self {
        Self {
            extra: roots.into_iter().collect(),
        }
    }

    /// The built-in roots, and each certificate in `pem`, of which there
    /// must be at least one. Anything else in it, such as a key, is left out.
    pub fn from_pem(pem: &[u8]) -> Result<Self, String> {
        if pem.len() > MAX_RELAY_CA_BYTES {
            return Err(format!(
                "too long for a few certificates (over {} KiB)",
                MAX_RELAY_CA_BYTES / 1024
            ));
        }
        let roots = CertificateDer::pem_slice_iter(pem)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| format!("not PEM: {err}"))?;
        if roots.is_empty() {
            return Err("no certificate in it (-----BEGIN CERTIFICATE-----)".into());
        }
        Ok(Self::with_roots(roots))
    }

    /// Whether it adds nothing to the built-in roots.
    pub fn is_built_in(&self) -> bool {
        self.extra.is_empty()
    }

    /// iroh's certificate settings for relays: the built-in roots and these.
    pub fn ca_tls_config(&self) -> CaTlsConfig {
        CaTlsConfig::embedded().with_extra_roots(self.extra.iter().cloned())
    }
}

/// What an end's endpoint is built with, beyond its key and relays. The
/// default is the app's: [`Mode::Auto`], and the built-in roots.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EndpointOptions {
    pub mode: Mode,
    pub trust: RelayTrust,
}

/// The builder both ends start from: `presets::Minimal` with `secret_key` and
/// `relay_mode`, no address lookup, no port mapping, the relay certificates
/// `options` trusts and, in [`Mode::RelayOnly`], no IP transports (in
/// [`Mode::Loopback`], loopback ones only).
pub fn builder(secret_key: SecretKey, relay_mode: RelayMode, options: &EndpointOptions) -> Builder {
    let mut builder = Endpoint::builder(presets::Minimal)
        .secret_key(secret_key)
        .relay_mode(relay_mode)
        .clear_address_lookup()
        .portmapper_config(PortmapperConfig::Disabled);
    // Left as iroh has it unless there's something to add.
    if !options.trust.is_built_in() {
        builder = builder.ca_tls_config(options.trust.ca_tls_config());
    }
    match options.mode {
        Mode::Auto => builder,
        Mode::RelayOnly => builder.clear_ip_transports(),
        Mode::Loopback => {
            let v4 = SocketAddr::from((Ipv4Addr::LOCALHOST, 0));
            let v6 = SocketAddr::from((Ipv6Addr::LOCALHOST, 0));
            // Only a second default socket of a family is refused, and the
            // defaults are cleared first.
            builder
                .clear_ip_transports()
                .bind_addr(v4)
                .and_then(|builder| builder.bind_addr(v6))
                .expect("one loopback socket of each family")
        }
    }
}

/// The phone's endpoint (and the test client's), with `relays` as its relay
/// map, and no ALPN, so it dials out and accepts no connection. It can still
/// dial a host through any relay: a relay map is only where the home relay
/// comes from.
pub async fn bind_client(
    secret_key: SecretKey,
    relays: &[RelayUrl],
    options: &EndpointOptions,
) -> Result<Endpoint, BindError> {
    let map: RelayMap = relays.iter().cloned().collect();
    builder(secret_key, RelayMode::Custom(map), options)
        .bind()
        .await
}

/// Whether the relay connection open now was told it's rate limited, from
/// iroh's `relay_conns_success` and `relay_conns_ratelimited` counters. A
/// relay says so once per connection, so a limit counts until the next
/// connection; one reported in the same second as a new connection is taken
/// to be the new one's. Both ends keep one: the host for `link/state.json`
/// (host/report.rs), the phone for its status (`Link::rate_limited`).
#[derive(Debug, Default)]
pub(crate) struct RateLimitWatch {
    conns: u64,
    limited: u64,
    base: u64,
}

impl RateLimitWatch {
    pub(crate) fn sample(&mut self, conns: u64, limited: u64) -> bool {
        if conns != self.conns {
            self.conns = conns;
            self.base = self.limited;
        }
        self.limited = limited;
        limited > self.base
    }

    /// [`sample`](Self::sample), from `endpoint`'s counters.
    pub(crate) fn sample_endpoint(&mut self, endpoint: &Endpoint) -> bool {
        let socket = &endpoint.metrics().socket;
        self.sample(
            socket.relay_conns_success.get(),
            socket.relay_conns_ratelimited.get(),
        )
    }
}

/// Moves the endpoint from relay `from` to relay `to`, which becomes its
/// home relay: added first, then `from` taken out, so it's never without
/// one. iroh doesn't say which relays an endpoint has, so the caller keeps
/// track: one bound with a single relay keeps a single relay this way.
pub async fn switch_relay(endpoint: &Endpoint, to: &RelayUrl, from: Option<&RelayUrl>) {
    let config = Arc::new(RelayConfig::from(to.clone()));
    endpoint.insert_relay(to.clone(), config).await;
    if let Some(from) = from.filter(|from| *from != to) {
        endpoint.remove_relay(from).await;
    }
}

#[cfg(test)]
mod tests {
    use iroh::endpoint::QuicTransportConfig;
    use iroh::{RelayUrl, Watcher};

    use super::*;

    /// The phone's idle timeout is the one in iroh's default.
    #[test]
    fn the_idle_timeout_is_iroh_s_default() {
        let config = format!("{:?}", QuicTransportConfig::default());
        let idle = format!("max_idle_timeout: Some({})", IDLE_TIMEOUT.as_millis());
        assert!(config.contains(&idle), "iroh's default config: {config}");
    }

    #[test]
    fn a_rate_limit_lasts_until_the_next_relay_connection() {
        let mut watch = RateLimitWatch::default();
        assert!(!watch.sample(1, 0));
        assert!(watch.sample(1, 1), "the relay said so");
        assert!(watch.sample(1, 1), "and it lasts");
        assert!(!watch.sample(2, 1), "a new connection, not limited yet");
        assert!(watch.sample(2, 2));
        // Limited at once: a new connection and its limit in one second.
        assert!(watch.sample(3, 3));
        assert!(!watch.sample(4, 3));
    }

    #[test]
    fn auto_is_the_default_and_only_relay_only_drops_ip() {
        assert_eq!(Mode::default(), Mode::Auto);
        assert!(Mode::Auto.keeps_ip_transports());
        assert!(Mode::Loopback.keeps_ip_transports());
        assert!(!Mode::RelayOnly.keeps_ip_transports());
    }

    /// Loopback binds its UDP sockets on 127.0.0.1 and [::1] only, so the
    /// direct addresses an end gives out never lead off the machine.
    #[tokio::test]
    async fn loopback_mode_binds_loopback_only() {
        let options = EndpointOptions {
            mode: Mode::Loopback,
            ..EndpointOptions::default()
        };
        let endpoint = builder(
            SecretKey::from_bytes(&[6; 32]),
            RelayMode::Disabled,
            &options,
        )
        .bind()
        .await
        .expect("binds");
        let sockets = endpoint.bound_sockets();
        assert!(sockets.iter().any(SocketAddr::is_ipv4), "{sockets:?}");
        assert!(sockets.iter().all(|s| s.ip().is_loopback()), "{sockets:?}");
        let mut addr = endpoint.watch_addr();
        let direct = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let direct: Vec<SocketAddr> = addr.get().ip_addrs().copied().collect();
                if !direct.is_empty() {
                    return direct;
                }
                addr.updated().await.expect("the endpoint is open");
            }
        })
        .await
        .expect("direct addresses within 10 s");
        assert!(direct.iter().all(|a| a.ip().is_loopback()), "{direct:?}");
        endpoint.close().await;
    }

    fn relay_only() -> EndpointOptions {
        EndpointOptions {
            mode: Mode::RelayOnly,
            ..EndpointOptions::default()
        }
    }

    /// Relay only binds no IP socket at all, so no direct path can open. iroh
    /// won't bind with no transport at all, so the relay here is a closed port
    /// on loopback: the test needs no network.
    #[tokio::test]
    async fn relay_only_binds_no_ip_socket() {
        let nowhere: RelayUrl = "https://127.0.0.1:1/".parse().expect("a relay URL");
        let endpoint = builder(
            SecretKey::from_bytes(&[3; 32]),
            RelayMode::custom([nowhere]),
            &relay_only(),
        )
        .bind()
        .await
        .expect("binds");
        assert_eq!(endpoint.bound_sockets(), vec![]);
        endpoint.close().await;
    }

    /// No address lookup: nothing publishes or asks where an end is.
    #[tokio::test]
    async fn an_end_has_no_address_lookup() {
        let endpoint = bind_client(
            SecretKey::from_bytes(&[5; 32]),
            &[nowhere(1)],
            &relay_only(),
        )
        .await
        .expect("binds");
        let lookup = endpoint.address_lookup().expect("open");
        assert!(lookup.is_empty(), "no address lookup");
        endpoint.close().await;
    }

    /// A self-signed certificate (openssl, P-256), as a test's relay has.
    const CERT: &str = "-----BEGIN CERTIFICATE-----
MIIBjDCCATOgAwIBAgIUG6AK7/BFmmXni65lK6R6jiB48rwwCgYIKoZIzj0EAwIw
GzEZMBcGA1UEAwwQa2xlaW8tdGVzdC1yZWxheTAgFw0yNjEwMjMwMjAxMzlaGA8y
MTI2MDkyOTAyMDEzOVowGzEZMBcGA1UEAwwQa2xlaW8tdGVzdC1yZWxheTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABKmEg7aJ0Da0OY3moyWj8C3r5EG+NFJJQLVN
QVlbjUojrb4lra55Tk4jxvOVg4LjhOmgrtPtaU7DZWtSQZ4C5VajUzBRMB0GA1Ud
DgQWBBQHBkFC1XUVSjgLjaA9KfH/SOaI4jAfBgNVHSMEGDAWgBQHBkFC1XUVSjgL
jaA9KfH/SOaI4jAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIHrB
bM5RCxppRQVmKfFE+DxHBGzbfE1Can/ka6ZgWChOAiBf+c9amTS0NPFQJZdLlvtz
NbRlbqCM+1/uLioxXi0HIA==
-----END CERTIFICATE-----
";

    #[test]
    fn adds_each_certificate_in_a_pem_file_to_the_built_in_roots() {
        assert!(RelayTrust::default().is_built_in());
        let one = RelayTrust::from_pem(CERT.as_bytes()).expect("a certificate");
        assert!(!one.is_built_in());
        assert_eq!(one.extra.len(), 1);
        // A key beside it is left out, and a second certificate is taken.
        let key =
            "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n";
        let two = RelayTrust::from_pem(format!("{CERT}{key}{CERT}").as_bytes()).expect("read");
        assert_eq!(two.extra.len(), 2);
    }

    #[test]
    fn refuses_a_file_with_no_certificate_or_too_much() {
        for (pem, why) in [
            (String::new(), "no certificate"),
            ("hello".to_string(), "no certificate"),
            (
                "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----\n"
                    .to_string(),
                "no certificate",
            ),
            (
                "-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----\n".to_string(),
                "not PEM",
            ),
            (CERT.repeat(MAX_RELAY_CA_BYTES / CERT.len() + 1), "too long"),
        ] {
            let err = RelayTrust::from_pem(pem.as_bytes()).expect_err("refused");
            assert!(err.starts_with(why), "{why}: {err}");
        }
    }

    /// Relays on closed loopback ports: nothing is asked, so no network.
    fn nowhere(port: u16) -> RelayUrl {
        format!("https://127.0.0.1:{port}/")
            .parse()
            .expect("a relay URL")
    }

    #[tokio::test]
    async fn switching_relay_leaves_the_endpoint_with_the_new_one_only() {
        let (a, b) = (nowhere(1), nowhere(2));
        let endpoint = bind_client(
            SecretKey::from_bytes(&[4; 32]),
            std::slice::from_ref(&a),
            &relay_only(),
        )
        .await
        .expect("binds");
        switch_relay(&endpoint, &b, Some(&a)).await;
        // `remove_relay` gives back what it took out: only `b` is left.
        assert!(endpoint.remove_relay(&a).await.is_none(), "a is gone");
        assert!(endpoint.remove_relay(&b).await.is_some(), "b is in");
        // Switching to the relay it's on takes nothing out.
        switch_relay(&endpoint, &a, None).await;
        switch_relay(&endpoint, &a, Some(&a)).await;
        assert!(endpoint.remove_relay(&a).await.is_some(), "a is in");
        endpoint.close().await;
    }
}
