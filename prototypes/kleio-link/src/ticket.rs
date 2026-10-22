//! The v3 pairing ticket: what the Kleio iPhone app reads from a QR code to
//! pair over the link.
//!
//! ```text
//! {"v":3,"type":"kleio-pair","key":"<64 hex>","relay":"https://<relay>/","code":"ABC-DEF"}
//! ```
//!
//! Anyone can print a QR code, so a ticket is untrusted input. The check is
//! offline: nothing is dialled until the person confirms the key, relay and
//! code it shows. It allows exactly these five fields in a JSON object, and
//! each only in the one form `kleio-link-host qr` writes, so what the confirm
//! step shows is what the phone dials. Like v2, a ticket never carries a
//! token: the code is single-use and expires in five minutes, and kleio-host
//! still decides by code, expiry and the five tries.

use std::fmt;
use std::str::FromStr;

use iroh::{EndpointId, RelayUrl};
use serde::{Deserialize, Serialize};

/// The version this module reads. v2 is today's Tailscale ticket, which goes
/// to today's pairing form instead.
pub const TICKET_VERSION: u64 = 3;

/// The `type` of every Kleio pairing ticket, v2 and v3.
pub const TICKET_TYPE: &str = "kleio-pair";

/// A real ticket is about 165 bytes. Anything longer than this is refused
/// before it is parsed.
pub const MAX_TICKET_BYTES: usize = 1024;

/// The host's pair alphabet, Crockford base32 (`PAIR_CODE_ALPHABET` in
/// packages/kleio-host/src/pair-code.ts).
pub const PAIR_CODE_ALPHABET: &str = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Characters in a pair code (`PAIR_CODE_LENGTH`). A ticket writes them as two
/// halves with a dash: `ABC-DEF`.
pub const PAIR_CODE_LENGTH: usize = 6;

const CODE_HALF: usize = PAIR_CODE_LENGTH / 2;

/// Why a ticket was refused. Each says so in words a person can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TicketError {
    /// Longer than [`MAX_TICKET_BYTES`].
    TooLong,
    /// Not a JSON object with a whole-number `v` and the `type` `kleio-pair`.
    NotKleio,
    /// A Kleio ticket of another version. v2 is today's Tailscale ticket.
    Version(u64),
    /// A v3 ticket with a field missing, added, repeated or of the wrong type.
    Fields,
    /// `key` isn't 64 lowercase hex characters naming an Ed25519 public key.
    Key,
    /// `relay` isn't `https://<host>/` with nothing else, written as a URL
    /// parser writes it.
    Relay,
    /// `code` isn't `ABC-DEF`, from the pair alphabet.
    Code,
}

impl fmt::Display for TicketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLong => f.write_str("This QR code is too long to be a Kleio pairing code."),
            Self::NotKleio => f.write_str("This QR code isn't a Kleio pairing code."),
            Self::Version(v) => write!(
                f,
                "This QR code is a version {v} Kleio pairing code; this build reads version {TICKET_VERSION}."
            ),
            Self::Fields => f.write_str("This QR code has missing or extra fields."),
            Self::Key => f.write_str("This QR code's host key isn't valid."),
            Self::Relay => f.write_str("This QR code's relay address isn't valid."),
            Self::Code => f.write_str("This QR code's pair code isn't valid."),
        }
    }
}

impl std::error::Error for TicketError {}

/// A ticket that passed the check: the host's key, the relay it is reached
/// through, and the pair code in its display form (`ABC-DEF`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ticket {
    key: EndpointId,
    relay: RelayUrl,
    code: String,
}

impl Ticket {
    /// The ticket `kleio-link-host qr` prints. `code` is what the person typed
    /// from `kleio-host pair`, folded as kleio-host folds it. The relay gets
    /// the same check a scanned ticket does, so no ticket the phone would
    /// refuse is ever drawn.
    pub fn new(key: EndpointId, relay: &RelayUrl, code: &str) -> Result<Self, TicketError> {
        let relay = check_relay(relay.as_str())?;
        let code = normalize_pair_code(code).ok_or(TicketError::Code)?;
        Ok(Self {
            key,
            relay,
            code: format!("{}-{}", &code[..CODE_HALF], &code[CODE_HALF..]),
        })
    }

    /// The host's key: the phone dials this, and iroh's handshake proves it.
    pub fn key(&self) -> EndpointId {
        self.key
    }

    /// The relay the host is reached through.
    pub fn relay(&self) -> &RelayUrl {
        &self.relay
    }

    /// The pair code, `ABC-DEF`.
    pub fn code(&self) -> &str {
        &self.code
    }

    /// The host key's first 8 characters, for the confirm step.
    pub fn key_prefix(&self) -> String {
        self.key.to_string()[..8].to_string()
    }

    /// The relay's host name, for the confirm step.
    pub fn relay_host(&self) -> &str {
        // The check requires a host, so this is never empty.
        self.relay.host_str().unwrap_or_default()
    }

    /// The ticket as JSON, fields in the order above.
    pub fn to_json(&self) -> String {
        let wire = WireOut {
            v: TICKET_VERSION,
            kind: TICKET_TYPE,
            key: self.key.to_string(),
            relay: self.relay.as_str(),
            code: &self.code,
        };
        serde_json::to_string(&wire).expect("a ticket of strings and a number serializes")
    }
}

impl FromStr for Ticket {
    type Err = TicketError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.len() > MAX_TICKET_BYTES {
            return Err(TicketError::TooLong);
        }
        // serde would also fill these structs from a JSON array; a ticket is
        // an object.
        if !s.trim_start().starts_with('{') {
            return Err(TicketError::NotKleio);
        }
        // The version and type first, so a v2 ticket is told apart from a
        // broken v3 one. serde refuses a repeated `v` or `type` here.
        let header: Header = serde_json::from_str(s).map_err(|_| TicketError::NotKleio)?;
        if header.kind != TICKET_TYPE {
            return Err(TicketError::NotKleio);
        }
        if header.v != TICKET_VERSION {
            return Err(TicketError::Version(header.v));
        }
        let wire: WireIn = serde_json::from_str(s).map_err(|_| TicketError::Fields)?;
        Ok(Self {
            key: check_key(&wire.key)?,
            relay: check_relay(&wire.relay)?,
            code: check_code(&wire.code)?,
        })
    }
}

/// Fold what a person typed into the six-character code, as kleio-host's
/// `normalizePairCode` does: spaces and dashes go, letters are uppercased, and
/// I, L and O, which the alphabet leaves out, become 1, 1 and 0. `None` unless
/// that leaves exactly six characters from the alphabet.
pub fn normalize_pair_code(raw: &str) -> Option<String> {
    let mut out = String::with_capacity(PAIR_CODE_LENGTH);
    for ch in raw.chars() {
        if ch.is_whitespace() || ch == '-' {
            continue;
        }
        let ch = match ch.to_ascii_uppercase() {
            'I' | 'L' => '1',
            'O' => '0',
            other => other,
        };
        if !PAIR_CODE_ALPHABET.contains(ch) || out.len() == PAIR_CODE_LENGTH {
            return None;
        }
        out.push(ch);
    }
    (out.len() == PAIR_CODE_LENGTH).then_some(out)
}

/// The fields every ticket version shares. Others are ignored here.
#[derive(Deserialize)]
struct Header {
    v: u64,
    #[serde(rename = "type")]
    kind: String,
}

/// A v3 ticket as read: exactly five fields, each once.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireIn {
    // Read only so that `deny_unknown_fields` allows them; `Header` checked them.
    #[allow(dead_code)]
    v: u64,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    kind: String,
    key: String,
    relay: String,
    code: String,
}

/// A v3 ticket as written.
#[derive(Serialize)]
struct WireOut<'a> {
    v: u64,
    #[serde(rename = "type")]
    kind: &'a str,
    key: String,
    relay: &'a str,
    code: &'a str,
}

/// 64 lowercase hex characters, then iroh's own parse, which also refuses
/// bytes that aren't an Ed25519 point. iroh would accept base32 as well; a
/// ticket has the one form `Display` writes.
fn check_key(s: &str) -> Result<EndpointId, TicketError> {
    let hex = s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !hex {
        return Err(TicketError::Key);
    }
    EndpointId::from_str(s).map_err(|_| TicketError::Key)
}

/// `https://<host>/` and nothing else: no user, password, port, path, query
/// or fragment. It must also be exactly how the URL parser writes it, so the
/// relay host the confirm step shows is the one dialled (no case, escapes or
/// non-ASCII names that read one way and parse another). `kleio-link-host
/// serve --relay` takes only what this takes, so a pinned relay can always go
/// in a ticket.
pub fn check_relay(s: &str) -> Result<RelayUrl, TicketError> {
    let relay = RelayUrl::from_str(s).map_err(|_| TicketError::Relay)?;
    let only_a_host = relay.scheme() == "https"
        && relay.host_str().is_some_and(|h| !h.is_empty())
        && relay.username().is_empty()
        && relay.password().is_none()
        && relay.port().is_none()
        && relay.path() == "/"
        && relay.query().is_none()
        && relay.fragment().is_none();
    if only_a_host && relay.as_str() == s {
        Ok(relay)
    } else {
        Err(TicketError::Relay)
    }
}

/// `ABC-DEF` exactly: three alphabet characters, a dash, three more.
fn check_code(s: &str) -> Result<String, TicketError> {
    let bytes = s.as_bytes();
    let ok = bytes.len() == PAIR_CODE_LENGTH + 1
        && bytes.iter().enumerate().all(|(i, &b)| {
            if i == CODE_HALF {
                b == b'-'
            } else {
                PAIR_CODE_ALPHABET.as_bytes().contains(&b)
            }
        });
    if ok {
        Ok(s.to_string())
    } else {
        Err(TicketError::Code)
    }
}

#[cfg(test)]
mod tests {
    use iroh::{PublicKey, SecretKey};
    use serde_json::{json, Value};

    use super::*;

    const RELAY: &str = "https://euc1-1.relay.n0.iroh.link./";

    fn host_key() -> EndpointId {
        SecretKey::from_bytes(&[7; 32]).public()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn good() -> Value {
        json!({
            "v": 3,
            "type": "kleio-pair",
            "key": host_key().to_string(),
            "relay": RELAY,
            "code": "ABC-DEF",
        })
    }

    /// `good()` with one field set to `value`.
    fn with(field: &str, value: Value) -> String {
        let mut ticket = good();
        ticket[field] = value;
        ticket.to_string()
    }

    /// `good()` without one field.
    fn without(field: &str) -> String {
        let mut ticket = good();
        ticket.as_object_mut().unwrap().remove(field);
        ticket.to_string()
    }

    fn parse(s: &str) -> Result<Ticket, TicketError> {
        s.parse()
    }

    #[test]
    fn reads_a_good_ticket() {
        let ticket = parse(&good().to_string()).unwrap();
        assert_eq!(ticket.key(), host_key());
        assert_eq!(ticket.relay().as_str(), RELAY);
        assert_eq!(ticket.code(), "ABC-DEF");
        assert_eq!(ticket.key_prefix(), host_key().to_string()[..8]);
        assert_eq!(ticket.relay_host(), "euc1-1.relay.n0.iroh.link.");
    }

    #[test]
    fn writes_what_it_reads() {
        let relay: RelayUrl = RELAY.parse().unwrap();
        let ticket = Ticket::new(host_key(), &relay, " abc def ").unwrap();
        assert_eq!(ticket.code(), "ABC-DEF");
        let written = ticket.to_json();
        assert!(written.starts_with(r#"{"v":3,"type":"kleio-pair","key":""#));
        assert_eq!(parse(&written).unwrap(), ticket);
        assert!(written.len() < 200, "{} bytes: {written}", written.len());
    }

    #[test]
    fn never_writes_a_ticket_it_would_refuse() {
        let http: RelayUrl = "http://euc1-1.relay.n0.iroh.link./".parse().unwrap();
        assert_eq!(
            Ticket::new(host_key(), &http, "ABC-DEF"),
            Err(TicketError::Relay)
        );
        let relay: RelayUrl = RELAY.parse().unwrap();
        for code in ["ABC-DE", "ABC-DEFG", "ABC-DEU", "", "ABC-DÉF"] {
            assert_eq!(
                Ticket::new(host_key(), &relay, code),
                Err(TicketError::Code),
                "{code:?}"
            );
        }
    }

    #[test]
    fn refuses_a_ticket_too_long_to_be_real() {
        let padded = format!("{}{}", good(), " ".repeat(MAX_TICKET_BYTES));
        assert_eq!(parse(&padded), Err(TicketError::TooLong));
    }

    #[test]
    fn refuses_what_isnt_a_kleio_ticket() {
        let trailing = format!("{}x", good());
        let key = host_key().to_string();
        let as_array = format!(r#"[3,"kleio-pair","{key}","{RELAY}","ABC-DEF"]"#);
        for s in [
            "",
            "not json",
            "[]",
            "3",
            r#""kleio-pair""#,
            "{}",
            trailing.as_str(),
            as_array.as_str(),
        ] {
            assert_eq!(parse(s), Err(TicketError::NotKleio), "{s:?}");
        }
    }

    #[test]
    fn refuses_a_wrong_or_missing_type() {
        for kind in [
            json!("kleio-pair2"),
            json!("Kleio-pair"),
            json!(""),
            json!(3),
            Value::Null,
        ] {
            assert_eq!(
                parse(&with("type", kind.clone())),
                Err(TicketError::NotKleio),
                "{kind}"
            );
        }
        assert_eq!(parse(&without("type")), Err(TicketError::NotKleio));
    }

    #[test]
    fn tells_other_versions_apart() {
        assert_eq!(parse(&with("v", json!(2))), Err(TicketError::Version(2)));
        assert_eq!(parse(&with("v", json!(4))), Err(TicketError::Version(4)));
        // Today's v2 ticket, as gg-app/src/kleio/pairTicket.ts writes it.
        let v2 = r#"{"v":2,"type":"kleio-pair","baseUrl":"https://mini.example.ts.net:8443","code":"ABC-DEF"}"#;
        assert_eq!(parse(v2), Err(TicketError::Version(2)));
    }

    #[test]
    fn refuses_a_version_that_isnt_a_whole_number() {
        for v in [json!("3"), json!(3.0), json!(-3), json!(3.5), Value::Null] {
            assert_eq!(
                parse(&with("v", v.clone())),
                Err(TicketError::NotKleio),
                "{v}"
            );
        }
        assert_eq!(parse(&without("v")), Err(TicketError::NotKleio));
    }

    #[test]
    fn refuses_missing_extra_or_repeated_fields() {
        for field in ["key", "relay", "code"] {
            assert_eq!(
                parse(&without(field)),
                Err(TicketError::Fields),
                "without {field}"
            );
            assert_eq!(
                parse(&with(field, json!(1))),
                Err(TicketError::Fields),
                "{field} as a number"
            );
        }
        assert_eq!(
            parse(&with("token", json!("t0k3n"))),
            Err(TicketError::Fields)
        );
        assert_eq!(
            parse(&with("baseUrl", json!("https://x.ts.net/"))),
            Err(TicketError::Fields)
        );

        let key = host_key().to_string();
        let repeated_code = format!(
            r#"{{"v":3,"type":"kleio-pair","key":"{key}","relay":"{RELAY}","code":"ABC-DEF","code":"XYZ-123"}}"#
        );
        assert_eq!(parse(&repeated_code), Err(TicketError::Fields));
        let repeated_v = format!(
            r#"{{"v":3,"v":3,"type":"kleio-pair","key":"{key}","relay":"{RELAY}","code":"ABC-DEF"}}"#
        );
        assert_eq!(parse(&repeated_v), Err(TicketError::NotKleio));
    }

    #[test]
    fn refuses_a_bad_key() {
        let key = host_key();
        let good_hex = key.to_string();
        let not_a_point = (0u8..=255)
            .map(|b| [b; 32])
            .find(|bytes| PublicKey::from_bytes(bytes).is_err())
            .map(|bytes| hex(&bytes))
            .expect("some 32 repeated bytes aren't an Ed25519 point");
        let bad = [
            String::new(),
            good_hex[..63].to_string(),
            format!("{good_hex}0"),
            good_hex.to_uppercase(),
            format!("g{}", &good_hex[1..]),
            // The base32 form iroh would accept, but a ticket doesn't.
            base32(key.as_bytes()),
            not_a_point,
        ];
        for k in bad {
            assert_eq!(
                parse(&with("key", json!(k))),
                Err(TicketError::Key),
                "{k:?}"
            );
        }
    }

    #[test]
    fn refuses_a_bad_relay() {
        for relay in [
            "http://euc1-1.relay.n0.iroh.link./",
            "wss://euc1-1.relay.n0.iroh.link./",
            "HTTPS://euc1-1.relay.n0.iroh.link./",
            "https://EUC1-1.relay.n0.iroh.link./",
            "https://euc1-1.relay.n0.iroh.link.",
            "https://euc1-1.relay.n0.iroh.link./relay",
            "https://euc1-1.relay.n0.iroh.link./?x=1",
            "https://euc1-1.relay.n0.iroh.link./#x",
            "https://me@euc1-1.relay.n0.iroh.link./",
            "https://me:pw@euc1-1.relay.n0.iroh.link./",
            "https://euc1-1.relay.n0.iroh.link.:443/",
            "https://euc1-1.relay.n0.iroh.link.:8443/",
            "https://relay.exämple.com/",
            "https://relay%2Eexample.com/",
            "https:///",
            "relay.n0.iroh.link",
            "",
        ] {
            assert_eq!(
                parse(&with("relay", json!(relay))),
                Err(TicketError::Relay),
                "{relay:?}"
            );
        }
    }

    /// The check takes any https host: a host that isn't a relay passes here
    /// and fails when the phone dials it (test 5).
    #[test]
    fn takes_any_https_host_as_the_relay() {
        let ticket = parse(&with("relay", json!("https://example.com/"))).unwrap();
        assert_eq!(ticket.relay_host(), "example.com");
    }

    #[test]
    fn refuses_a_bad_code() {
        for code in [
            "ABCDEF", "abc-def", "ABC-DEI", "ABC-DEL", "ABC-DEO", "ABC-DEU", "AB-CDEF", "ABC-DEFG",
            "ABC_DEF", " ABC-DEF", "ABC-DE", "",
        ] {
            assert_eq!(
                parse(&with("code", json!(code))),
                Err(TicketError::Code),
                "{code:?}"
            );
        }
    }

    #[test]
    fn folds_a_typed_code_as_the_host_does() {
        assert_eq!(normalize_pair_code("abc-def").as_deref(), Some("ABCDEF"));
        assert_eq!(
            normalize_pair_code(" ab c-d ef\t").as_deref(),
            Some("ABCDEF")
        );
        assert_eq!(normalize_pair_code("ilo-abc").as_deref(), Some("110ABC"));
        for raw in ["ABC-DE", "ABC-DEFG", "ABC-DEU", "ABC_DEF", "ABC-DÉF", ""] {
            assert_eq!(normalize_pair_code(raw), None, "{raw:?}");
        }
    }

    /// RFC 4648 base32 without padding: the 52-character form iroh also parses.
    fn base32(bytes: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let mut out = String::new();
        let mut buffer = 0u32;
        let mut bits = 0;
        for &b in bytes {
            buffer = (buffer << 8) | u32::from(b);
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                out.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
            }
        }
        if bits > 0 {
            out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
        }
        out
    }
}
