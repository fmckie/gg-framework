//! The v4 pairing ticket: what a pairing QR code carries, as kleio-host's
//! `buildTicket` writes it (packages/kleio-host/src/link.ts).
//!
//! ```text
//! {"v":4,"type":"kleio-pair","name":"mac-mini-1","key":"<64 hex>",
//!  "relays":["https://euc1-1.relay.n0.iroh.link./","n0"],
//!  "addrs":["192.168.1.20:52043"],"code":"ABC-DEF"}
//! ```
//!
//! - `relays` starts with the relay the host is on now, which pairing goes
//!   through, and goes on with the host's relay list, where `n0` stands for
//!   n0's relays (crate::relays): up to [`MAX_RELAYS`] entries.
//! - `addrs` holds up to [`MAX_TICKET_ADDRS`] of the host's direct addresses.
//!
//! Anyone can print a QR code, so a ticket is untrusted input. The check is
//! offline: nothing is dialled until the person confirms what it shows. It
//! takes exactly these seven fields in a JSON object, each only in the one
//! form kleio-host writes, so what the confirm step shows is what the phone
//! dials. Like v2, a ticket never carries a token: the code is single-use and
//! expires in five minutes, and kleio-host still decides by code, expiry and
//! the five tries. tests/fixtures/tickets.json holds the test vectors
//! kleio-host's and the app's tests share.

use std::collections::BTreeSet;
use std::fmt;
use std::net::SocketAddr;
use std::str::FromStr;

use iroh::{EndpointId, RelayUrl};
use serde::{Deserialize, Serialize};

use crate::relays::{check_relay_list, RelayEntry, MAX_RELAYS};

/// The version this module reads.
pub const TICKET_VERSION: u64 = 4;

/// The Tailscale pairing ticket's version (gg-app/src/kleio/pairTicket.ts),
/// which the pairing form reads, not this.
pub const TAILSCALE_TICKET_VERSION: u64 = 2;

/// The version the connection prototype's test build wrote.
pub const PROTOTYPE_TICKET_VERSION: u64 = 3;

/// The `type` of every Kleio pairing ticket.
pub const TICKET_TYPE: &str = "kleio-pair";

/// kleio-host's `MAX_TICKET_BYTES`. Anything longer is refused before it is
/// parsed. The default ticket is under 300 bytes, for an 80-column
/// terminal's QR code.
pub const MAX_TICKET_BYTES: usize = 512;

/// Direct addresses in a ticket (`MAX_TICKET_ADDRS`).
pub const MAX_TICKET_ADDRS: usize = 2;

/// The longest host name, in UTF-8 bytes (`MAX_NAME_BYTES`).
pub const MAX_NAME_BYTES: usize = 32;

/// Hex characters of the host key the confirm step shows: iroh's
/// `fmt_short`, as `kleio-host status` and kleio-link-host's log write it.
pub const KEY_PREFIX_LENGTH: usize = 10;

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
    /// Not a JSON object with a whole-number `v` and the `type` `kleio-pair`,
    /// or a version no Kleio wrote.
    NotKleio,
    /// A v2 ticket. A whole one goes to the Tailscale pairing form, so one
    /// here is one the form refused.
    Tailscale,
    /// A v3 ticket, from the connection prototype's test build.
    Prototype,
    /// A version newer than this build reads.
    Newer(u64),
    /// A v4 ticket with a field missing, added, repeated or of the wrong type.
    Fields,
    /// `name` isn't 1 to 32 bytes of text as kleio-host's `ticketName` leaves
    /// it.
    Name,
    /// `key` isn't 64 lowercase hex characters naming an Ed25519 public key.
    Key,
    /// `relays` isn't 1 to 4 relay addresses or `n0`, none twice, with the
    /// relay the host is on first.
    Relays,
    /// `addrs` isn't up to two direct addresses, none twice.
    Addrs,
    /// `code` isn't `ABC-DEF`, from the pair alphabet.
    Code,
}

impl fmt::Display for TicketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const AGAIN: &str = "Show a new one on your host and scan that.";
        match self {
            Self::TooLong => f.write_str("This QR code is too long to be a Kleio pairing code."),
            Self::NotKleio => f.write_str("That isn't a Kleio pairing code."),
            Self::Tailscale => f.write_str(
                "This QR code says it's a Tailscale pairing code, but it's incomplete. Show a new one on your host.",
            ),
            Self::Prototype => f.write_str(
                "This QR code comes from a test build of Kleio's link. Update Kleio on your host, then show a new QR code and scan that.",
            ),
            Self::Newer(_) => f.write_str(
                "This QR code comes from a newer Kleio. Update Kleio on this device, then scan it again.",
            ),
            Self::Fields => write!(f, "This QR code has parts missing or added. {AGAIN}"),
            Self::Name => write!(f, "This QR code's host name isn't valid. {AGAIN}"),
            Self::Key => write!(f, "This QR code's host key isn't valid. {AGAIN}"),
            Self::Relays => write!(f, "This QR code's relays aren't valid. {AGAIN}"),
            Self::Addrs => write!(f, "This QR code's host addresses aren't valid. {AGAIN}"),
            Self::Code => write!(f, "This QR code's pair code isn't valid. {AGAIN}"),
        }
    }
}

impl std::error::Error for TicketError {}

/// A ticket that passed the check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ticket {
    name: String,
    key: EndpointId,
    /// `relays[0]`: the relay the host was on, which pairing goes through.
    relay: RelayUrl,
    relays: Vec<RelayEntry>,
    addrs: Vec<SocketAddr>,
    code: String,
}

impl Ticket {
    /// What the host calls itself. Anyone can write any name in a QR code,
    /// so it's a label, not a check.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The host's key: the phone dials this, and iroh's handshake proves it.
    pub fn key(&self) -> EndpointId {
        self.key
    }

    /// The relay the host was on when it made the ticket: pairing goes
    /// through it, and only it.
    pub fn relay(&self) -> &RelayUrl {
        &self.relay
    }

    /// Every entry of `relays`, [`relay`](Self::relay) first.
    pub fn relays(&self) -> &[RelayEntry] {
        &self.relays
    }

    /// Whether the relay list names n0's relays.
    pub fn names_n0(&self) -> bool {
        self.relays.contains(&RelayEntry::N0)
    }

    /// The host's direct addresses, best first.
    pub fn addrs(&self) -> &[SocketAddr] {
        &self.addrs
    }

    /// The pair code, `ABC-DEF`.
    pub fn code(&self) -> &str {
        &self.code
    }

    /// The host key's first [`KEY_PREFIX_LENGTH`] characters, for the confirm
    /// step.
    pub fn key_prefix(&self) -> String {
        self.key.to_string()[..KEY_PREFIX_LENGTH].to_string()
    }

    /// The pairing relay's host name, for the confirm step.
    pub fn relay_host(&self) -> &str {
        // The check requires a host, so this is never empty.
        self.relay.host_str().unwrap_or_default()
    }

    /// The ticket as JSON, as kleio-host writes it, byte for byte.
    pub fn to_json(&self) -> String {
        let wire = WireOut {
            v: TICKET_VERSION,
            kind: TICKET_TYPE,
            name: &self.name,
            key: self.key.to_string(),
            relays: self.relays.iter().map(RelayEntry::as_str).collect(),
            addrs: self.addrs.iter().map(ToString::to_string).collect(),
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
        // The version and type first, so other versions are told apart from
        // a broken v4. serde refuses a repeated `v` or `type` here.
        let header: Header = serde_json::from_str(s).map_err(|_| TicketError::NotKleio)?;
        if header.kind != TICKET_TYPE {
            return Err(TicketError::NotKleio);
        }
        match header.v {
            TICKET_VERSION => {}
            PROTOTYPE_TICKET_VERSION => return Err(TicketError::Prototype),
            TAILSCALE_TICKET_VERSION => return Err(TicketError::Tailscale),
            v if v > TICKET_VERSION => return Err(TicketError::Newer(v)),
            _ => return Err(TicketError::NotKleio),
        }
        let wire: WireIn = serde_json::from_str(s).map_err(|_| TicketError::Fields)?;
        let (relay, relays) = check_relays(&wire.relays)?;
        Ok(Self {
            name: check_name(&wire.name)?,
            key: check_key(&wire.key)?,
            relay,
            relays,
            addrs: check_addrs(&wire.addrs)?,
            code: check_code(&wire.code)?,
        })
    }
}

/// The fields every ticket version shares. Others are ignored here.
#[derive(Deserialize)]
struct Header {
    v: u64,
    #[serde(rename = "type")]
    kind: String,
}

/// A v4 ticket as read: exactly seven fields, each once.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireIn {
    // Read only so that `deny_unknown_fields` allows them; `Header` checked them.
    #[allow(dead_code)]
    v: u64,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    kind: String,
    name: String,
    key: String,
    relays: Vec<String>,
    addrs: Vec<String>,
    code: String,
}

/// A v4 ticket as written: the fields in `buildTicket`'s order.
#[derive(Serialize)]
struct WireOut<'a> {
    v: u64,
    #[serde(rename = "type")]
    kind: &'a str,
    name: &'a str,
    key: String,
    relays: Vec<&'a str>,
    addrs: Vec<String>,
    code: &'a str,
}

/// 1 to [`MAX_NAME_BYTES`] bytes, exactly as kleio-host's `ticketName` leaves
/// a name: no control or format characters (bidi overrides and zero-width
/// characters among them, which could make a name read other than it is), no
/// space but U+0020, and none at either end or two together.
fn check_name(s: &str) -> Result<String, TicketError> {
    let fits = !s.is_empty() && s.len() <= MAX_NAME_BYTES;
    let clean = s
        .chars()
        .all(|c| !c.is_control() && !is_format(c) && (c == ' ' || !c.is_whitespace()));
    let spaced = !s.starts_with(' ') && !s.ends_with(' ') && !s.contains("  ");
    if fits && clean && spaced {
        Ok(s.to_string())
    } else {
        Err(TicketError::Name)
    }
}

/// Unicode's format characters (general category Cf, Unicode 15.1), which
/// `ticketName` takes out with `\p{Cf}`.
fn is_format(c: char) -> bool {
    matches!(
        u32::from(c),
        0x00AD
            | 0x0600..=0x0605
            | 0x061C
            | 0x06DD
            | 0x070F
            | 0x0890..=0x0891
            | 0x08E2
            | 0x180E
            | 0x200B..=0x200F
            | 0x202A..=0x202E
            | 0x2060..=0x2064
            | 0x2066..=0x206F
            | 0xFEFF
            | 0xFFF9..=0xFFFB
            | 0x110BD
            | 0x110CD
            | 0x13430..=0x1343F
            | 0x1BCA0..=0x1BCA3
            | 0x1D173..=0x1D17A
            | 0xE0001
            | 0xE0020..=0xE007F
    )
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

/// A relay list (crate::relays), whose first entry is a relay's address.
fn check_relays(entries: &[String]) -> Result<(RelayUrl, Vec<RelayEntry>), TicketError> {
    let list = check_relay_list(entries.iter().map(String::as_str)).ok_or(TicketError::Relays)?;
    debug_assert!(list.len() <= MAX_RELAYS);
    match list.first() {
        Some(RelayEntry::Url(relay)) => Ok((relay.clone(), list.clone())),
        _ => Err(TicketError::Relays),
    }
}

/// Up to [`MAX_TICKET_ADDRS`] direct addresses, none twice.
fn check_addrs(addrs: &[String]) -> Result<Vec<SocketAddr>, TicketError> {
    if addrs.len() > MAX_TICKET_ADDRS {
        return Err(TicketError::Addrs);
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::with_capacity(addrs.len());
    for text in addrs {
        let addr = check_direct_addr(text).ok_or(TicketError::Addrs)?;
        if !seen.insert(addr) {
            return Err(TicketError::Addrs);
        }
        out.push(addr);
    }
    Ok(out)
}

/// A direct address as kleio-host's `isDirectAddr` takes one: written exactly
/// as Rust writes it (`192.0.2.1:7842`, `[2001:db8::1]:7842`), with a port,
/// and one a phone could use: not loopback, unspecified or `0.x.x.x`, and no
/// IPv6 zone.
pub fn check_direct_addr(s: &str) -> Option<SocketAddr> {
    let addr = SocketAddr::from_str(s).ok()?;
    if addr.to_string() != s || addr.port() == 0 {
        return None;
    }
    let usable = match addr {
        SocketAddr::V4(v4) => {
            let ip = v4.ip();
            !ip.is_loopback() && ip.octets()[0] != 0
        }
        SocketAddr::V6(v6) => {
            let ip = v6.ip();
            !ip.is_loopback() && !ip.is_unspecified() && v6.scope_id() == 0 && v6.flowinfo() == 0
        }
    };
    usable.then_some(addr)
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
    use crate::testing::pairing_messages;

    const RELAY: &str = "https://euc1-1.relay.n0.iroh.link./";

    fn host_key() -> EndpointId {
        SecretKey::from_bytes(&[7; 32]).public()
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn good() -> Value {
        json!({
            "v": 4,
            "type": "kleio-pair",
            "name": "mac-mini-1",
            "key": host_key().to_string(),
            "relays": [RELAY, "n0"],
            "addrs": ["192.168.1.20:52043"],
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

    /// The vectors kleio-host's `buildTicket` makes (its tests check that).
    fn vectors() -> Vec<Value> {
        let file: Value = serde_json::from_str(include_str!("../tests/fixtures/tickets.json"))
            .expect("the vectors are JSON");
        file["good"].as_array().expect("good vectors").clone()
    }

    #[test]
    fn reads_every_ticket_kleio_host_writes_as_it_was_built() {
        let vectors = vectors();
        assert!(vectors.len() >= 6, "{} vectors", vectors.len());
        for vector in vectors {
            let about = vector["about"].as_str().expect("about");
            let text = vector["ticket"].as_str().expect("a ticket");
            let build = &vector["build"];
            let ticket = parse(text).unwrap_or_else(|err| panic!("{about}: {err:?}"));
            assert_eq!(
                ticket.to_json(),
                text,
                "{about}: writes it back byte for byte"
            );
            assert_eq!(ticket.name(), build["name"], "{about}");
            assert_eq!(ticket.key().to_string(), build["key"], "{about}");
            assert_eq!(ticket.relay().as_str(), build["relay"], "{about}");
            // The relay it's on, then the list, each once, at most four.
            let mut expected: Vec<&str> = vec![build["relay"].as_str().expect("relay")];
            for entry in build["relays"].as_array().expect("relays") {
                let entry = entry.as_str().expect("an entry");
                if !expected.contains(&entry) {
                    expected.push(entry);
                }
            }
            expected.truncate(MAX_RELAYS);
            let relays: Vec<&str> = ticket.relays().iter().map(RelayEntry::as_str).collect();
            assert_eq!(relays, expected, "{about}");
            assert_eq!(
                ticket.names_n0(),
                expected.contains(&"n0"),
                "{about}: names n0"
            );
            let addrs: Vec<String> = ticket.addrs().iter().map(ToString::to_string).collect();
            assert_eq!(Value::from(addrs), build["addrs"], "{about}");
            let code: String = build["code"]
                .as_str()
                .expect("code")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .map(|c| c.to_ascii_uppercase())
                .collect();
            assert_eq!(
                ticket.code(),
                format!("{}-{}", &code[..3], &code[3..]),
                "{about}"
            );
        }
    }

    #[test]
    fn the_default_ticket_fits_an_80_column_terminals_qr_code() {
        let longest = vectors()
            .into_iter()
            .find(|v| {
                v["about"]
                    .as_str()
                    .is_some_and(|a| a.starts_with("the longest default"))
            })
            .expect("the longest default vector");
        assert!(longest["ticket"].as_str().expect("a ticket").len() < 300);
    }

    #[test]
    fn shows_what_the_confirm_step_needs() {
        let ticket = parse(&good().to_string()).unwrap();
        assert_eq!(ticket.name(), "mac-mini-1");
        assert_eq!(ticket.key(), host_key());
        assert_eq!(ticket.key_prefix(), host_key().fmt_short().to_string());
        assert_eq!(ticket.key_prefix().len(), KEY_PREFIX_LENGTH);
        assert_eq!(ticket.relay().as_str(), RELAY);
        assert_eq!(ticket.relay_host(), "euc1-1.relay.n0.iroh.link.");
        assert_eq!(ticket.code(), "ABC-DEF");
        assert!(ticket.names_n0());
        let own = with("relays", json!(["https://relay.example.com/"]));
        assert!(!parse(&own).unwrap().names_n0());
    }

    #[test]
    fn refuses_a_ticket_too_long_to_be_real() {
        let padded = format!("{}{}", good(), " ".repeat(MAX_TICKET_BYTES));
        assert_eq!(parse(&padded), Err(TicketError::TooLong));
        let long_name = with("name", json!("x".repeat(MAX_TICKET_BYTES)));
        assert_eq!(parse(&long_name), Err(TicketError::TooLong));
    }

    #[test]
    fn refuses_what_isnt_a_kleio_ticket() {
        let trailing = format!("{}x", good());
        let as_array = format!(r#"[4,"kleio-pair","{}"]"#, host_key());
        for s in [
            "",
            "not json",
            "[]",
            "4",
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
            json!(4),
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
        assert_eq!(parse(&with("v", json!(2))), Err(TicketError::Tailscale));
        assert_eq!(parse(&with("v", json!(3))), Err(TicketError::Prototype));
        assert_eq!(parse(&with("v", json!(5))), Err(TicketError::Newer(5)));
        for v in [0, 1] {
            assert_eq!(parse(&with("v", json!(v))), Err(TicketError::NotKleio));
        }
        // Today's v2 ticket, as gg-app/src/kleio/pairTicket.ts writes it.
        let v2 = r#"{"v":2,"type":"kleio-pair","baseUrl":"https://mini.example.ts.net:8443","code":"ABC-DEF"}"#;
        assert_eq!(parse(v2), Err(TicketError::Tailscale));
        // The prototype's v3 ticket.
        let v3 = format!(
            r#"{{"v":3,"type":"kleio-pair","key":"{}","relay":"{RELAY}","code":"ABC-DEF"}}"#,
            host_key()
        );
        assert_eq!(parse(&v3), Err(TicketError::Prototype));
    }

    #[test]
    fn refuses_a_version_that_isnt_a_whole_number() {
        for v in [json!("4"), json!(4.0), json!(-4), json!(4.5), Value::Null] {
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
        for field in ["name", "key", "relays", "addrs", "code"] {
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
        for (field, value) in [
            ("token", json!("t0k3n")),
            ("relay", json!(RELAY)),
            ("baseUrl", json!("https://x.ts.net/")),
        ] {
            assert_eq!(
                parse(&with(field, value)),
                Err(TicketError::Fields),
                "{field}"
            );
        }
        assert_eq!(
            parse(&with("relays", json!([RELAY, 4]))),
            Err(TicketError::Fields)
        );
        let good = good().to_string();
        let repeated_code = good.replace(
            r#""code":"ABC-DEF""#,
            r#""code":"ABC-DEF","code":"XYZ-123""#,
        );
        assert_eq!(parse(&repeated_code), Err(TicketError::Fields));
        let repeated_v = good.replace(r#""v":4"#, r#""v":4,"v":4"#);
        assert_eq!(parse(&repeated_v), Err(TicketError::NotKleio));
    }

    #[test]
    fn takes_a_name_as_kleio_host_leaves_it() {
        for name in [
            "m",
            "mac-mini-1",
            "Will’s Mac mini",
            "Wills-Mac-mini-in-the-office-123",
            "Café du Kleio",
            "メインのマック",
            "🖥️ desk",
        ] {
            let ticket =
                parse(&with("name", json!(name))).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(ticket.name(), name);
        }
    }

    #[test]
    fn refuses_a_name_kleio_host_wouldnt_write() {
        for name in [
            String::new(),
            "x".repeat(MAX_NAME_BYTES + 1),
            // 33 bytes: eleven three-byte characters.
            "メ".repeat(11),
            " mini".into(),
            "mini ".into(),
            "mac  mini".into(),
            "mac\tmini".into(),
            "mac\nmini".into(),
            "mac\u{a0}mini".into(),
            "mac\u{3000}mini".into(),
            "mac\u{7}mini".into(),
            "mac\u{85}mini".into(),
            // Bidi overrides and isolates, zero-width characters and tags.
            "\u{202e}inim cam".into(),
            "mac\u{2066}mini\u{2069}".into(),
            "mac\u{200b}mini".into(),
            "mac\u{200d}mini".into(),
            "\u{feff}mini".into(),
            "mini\u{e0041}".into(),
            "mac\u{ad}mini".into(),
        ] {
            assert_eq!(
                parse(&with("name", json!(name))),
                Err(TicketError::Name),
                "{name:?}"
            );
        }
        assert_eq!(
            parse(&with("name", json!("x".repeat(MAX_NAME_BYTES)))).map(|t| t.name().len()),
            Ok(MAX_NAME_BYTES)
        );
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
    fn takes_relays_with_a_port_and_any_https_host() {
        let ticket = parse(&with(
            "relays",
            json!([
                "https://relay2.example.net:8443/",
                "https://relay1.example.net/",
                "n0"
            ]),
        ))
        .unwrap();
        assert_eq!(ticket.relay().as_str(), "https://relay2.example.net:8443/");
        assert_eq!(ticket.relay_host(), "relay2.example.net");
        assert_eq!(ticket.relays().len(), 3);
        // A host that isn't a relay passes here, and fails when the phone
        // asks it (pairing case 5).
        let ticket = parse(&with("relays", json!(["https://example.com/"]))).unwrap();
        assert_eq!(ticket.relay_host(), "example.com");
    }

    #[test]
    fn refuses_bad_relays() {
        let own = "https://relay.example.com/";
        for relays in [
            json!([]),
            json!(["n0"]),
            json!(["n0", RELAY]),
            json!([RELAY, RELAY]),
            json!([RELAY, "n0", "n0"]),
            json!([
                RELAY,
                own,
                "n0",
                "https://a.example.com/",
                "https://b.example.com/"
            ]),
            json!(["http://relay.example.com/"]),
            json!(["wss://euc1-1.relay.n0.iroh.link./"]),
            json!(["https://EUC1-1.relay.n0.iroh.link./"]),
            json!(["https://euc1-1.relay.n0.iroh.link."]),
            json!(["https://euc1-1.relay.n0.iroh.link./relay"]),
            json!(["https://euc1-1.relay.n0.iroh.link./?x=1"]),
            json!(["https://me@euc1-1.relay.n0.iroh.link./"]),
            json!(["https://euc1-1.relay.n0.iroh.link.:443/"]),
            json!(["https://relay.exämple.com/"]),
            json!(["https://relay%2Eexample.com/"]),
            json!([RELAY, "n1"]),
            json!(RELAY),
        ] {
            let expected = if relays.is_array()
                && relays
                    .as_array()
                    .is_some_and(|a| a.iter().all(Value::is_string))
            {
                TicketError::Relays
            } else {
                TicketError::Fields
            };
            assert_eq!(
                parse(&with("relays", relays.clone())),
                Err(expected),
                "{relays}"
            );
        }
    }

    #[test]
    fn takes_up_to_two_direct_addresses_as_rust_writes_them() {
        for addrs in [
            json!([]),
            json!(["192.168.1.20:52043"]),
            json!([
                "203.0.113.254:65535",
                "[2a02:c7c8:aaaa:bbbb:cccc:dddd:eeee:ffff]:65535"
            ]),
            json!(["[2001:db8::7]:7842", "10.0.0.2:1"]),
        ] {
            let ticket =
                parse(&with("addrs", addrs.clone())).unwrap_or_else(|e| panic!("{addrs}: {e}"));
            let written: Vec<String> = ticket.addrs().iter().map(ToString::to_string).collect();
            assert_eq!(Value::from(written), addrs);
        }
    }

    #[test]
    fn refuses_bad_direct_addresses() {
        for addr in [
            "192.168.1.20",
            "192.168.1.20:0",
            "192.168.1.20:65536",
            "192.168.001.20:52043",
            "127.0.0.1:52043",
            "0.0.0.0:52043",
            "0.1.2.3:52043",
            "[::1]:52043",
            "[::]:52043",
            "[2001:DB8::7]:7842",
            "[2001:db8:0:0:0:0:0:7]:7842",
            "[fe80::1%3]:7842",
            "[::ffff:102:304]:7842",
            "2001:db8::7:7842",
            "mini.local:7842",
            " 192.168.1.20:52043",
        ] {
            assert_eq!(
                parse(&with("addrs", json!([addr]))),
                Err(TicketError::Addrs),
                "{addr:?}"
            );
        }
        let three = json!(["10.0.0.1:1", "10.0.0.2:1", "10.0.0.3:1"]);
        assert_eq!(parse(&with("addrs", three)), Err(TicketError::Addrs));
        let twice = json!(["10.0.0.1:1", "10.0.0.1:1"]);
        assert_eq!(parse(&with("addrs", twice)), Err(TicketError::Addrs));
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
    fn every_refusal_says_something_different() {
        let all = [
            TicketError::TooLong,
            TicketError::NotKleio,
            TicketError::Tailscale,
            TicketError::Prototype,
            TicketError::Newer(5),
            TicketError::Fields,
            TicketError::Name,
            TicketError::Key,
            TicketError::Relays,
            TicketError::Addrs,
            TicketError::Code,
        ];
        let texts: BTreeSet<String> = all.iter().map(ToString::to_string).collect();
        assert_eq!(texts.len(), all.len());
        assert_eq!(
            TicketError::NotKleio.to_string(),
            "That isn't a Kleio pairing code."
        );
    }

    /// The table the app's tests share (tests/fixtures/pairing-messages.json)
    /// has these refusals' words. The app's own reader says the first two the
    /// same way, before a ticket gets here.
    #[test]
    fn says_the_pairing_tables_words() {
        let rows = pairing_messages("ticket.rs");
        assert_eq!(rows.len(), 3, "the table's cases from ticket.rs");
        for (id, words) in &rows {
            let err = match id.as_str() {
                "tailscale" => TicketError::Tailscale,
                "not-kleio" => TicketError::NotKleio,
                "prototype" => TicketError::Prototype,
                other => panic!("the table has {other} from ticket.rs, which says no such thing"),
            };
            assert_eq!(err.to_string(), *words, "{id}");
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
