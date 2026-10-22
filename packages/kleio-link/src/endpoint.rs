//! The iroh endpoint both ends bind.
//!
//! - No address lookup, so nothing talks to n0's `dns.iroh.link`: the phone
//!   reaches the host through the relay its ticket names.
//! - No port mapping, so nothing asks the router to open a port. (The crate
//!   also leaves out iroh's `portmapper` feature.)
//! - The phone uses n0's default relays for its own home relay. The host
//!   (`kleio-link-host`) starts from the same [`builder`] with its relay
//!   pinned, and adds its ALPNs and gate hook.

use std::time::Duration;

use iroh::endpoint::{presets, BindError, Builder, PortmapperConfig};
use iroh::{Endpoint, RelayMode, SecretKey};

/// How long an end waits on a connection it hears nothing on before it drops
/// it: QUIC's idle timeout. Neither end sets a transport config, so both take
/// iroh's default (`QuicTransportConfig::default`), which keeps noq's 30 s
/// `max_idle_timeout` (RFC 9308 § 3.2), and a connection runs on the smaller
/// of the two ends' values. A phone suspended for longer can't tell that the
/// host has dropped the connection. A test checks this against iroh's
/// default.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// The Link card's switch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    /// Through the relay at first, then direct once iroh finds a path.
    #[default]
    Auto,
    /// Through the relay only. The endpoint has no IP transports, so no
    /// direct path can open.
    RelayOnly,
}

impl Mode {
    /// Whether the endpoint keeps its IP (UDP) transports, which a direct path
    /// needs.
    pub fn keeps_ip_transports(self) -> bool {
        match self {
            Self::Auto => true,
            Self::RelayOnly => false,
        }
    }
}

/// The builder both ends start from: `presets::Minimal` with `secret_key` and
/// `relay_mode`, no address lookup, no port mapping and, in
/// [`Mode::RelayOnly`], no IP transports.
pub fn builder(secret_key: SecretKey, relay_mode: RelayMode, mode: Mode) -> Builder {
    let builder = Endpoint::builder(presets::Minimal)
        .secret_key(secret_key)
        .relay_mode(relay_mode)
        .clear_address_lookup()
        .portmapper_config(PortmapperConfig::Disabled);
    if mode.keeps_ip_transports() {
        builder
    } else {
        builder.clear_ip_transports()
    }
}

/// The phone's endpoint (and the laptop test client's): n0's default relays,
/// and no ALPN, so it dials out and accepts no connection.
pub async fn bind_client(secret_key: SecretKey, mode: Mode) -> Result<Endpoint, BindError> {
    builder(secret_key, RelayMode::Default, mode).bind().await
}

#[cfg(test)]
mod tests {
    use iroh::endpoint::QuicTransportConfig;
    use iroh::RelayUrl;

    use super::*;

    /// Neither end sets a transport config, so the idle timeout is the one in
    /// iroh's default.
    #[test]
    fn the_idle_timeout_is_iroh_s_default() {
        let config = format!("{:?}", QuicTransportConfig::default());
        let idle = format!("max_idle_timeout: Some({})", IDLE_TIMEOUT.as_millis());
        assert!(config.contains(&idle), "iroh's default config: {config}");
    }

    #[test]
    fn auto_is_the_default_and_only_relay_only_drops_ip() {
        assert_eq!(Mode::default(), Mode::Auto);
        assert!(Mode::Auto.keeps_ip_transports());
        assert!(!Mode::RelayOnly.keeps_ip_transports());
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
            Mode::RelayOnly,
        )
        .bind()
        .await
        .expect("binds");
        assert_eq!(endpoint.bound_sockets(), vec![]);
        endpoint.close().await;
    }
}
