//! The open `kleio/http/0` connections, so a key taken off the allow-list
//! loses its connection at once, not only its next one.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use iroh::endpoint::{Connection, VarInt, WeakConnectionHandle};
use iroh::EndpointId;
use tracing::warn;

use super::gate::{AllowList, Standing};
use crate::close;

/// One open connection.
#[derive(Debug, Clone)]
struct Open {
    key: EndpointId,
    /// Tells one connection from the key's next.
    serial: u64,
    conn: WeakConnectionHandle,
}

#[derive(Debug, Default)]
struct List {
    open: Vec<Open>,
    next: u64,
}

/// The open connections. Cheap to clone; clones share the list. It holds
/// only weak handles, so it never keeps a connection open.
#[derive(Debug, Clone, Default)]
pub(crate) struct OpenLinks(Arc<Mutex<List>>);

impl OpenLinks {
    /// Adds `conn`, and gives its serial.
    pub(crate) fn add(&self, conn: &Connection) -> u64 {
        let mut list = self.locked();
        let serial = list.next;
        list.next += 1;
        list.open.push(Open {
            key: conn.remote_id(),
            serial,
            conn: conn.weak_handle(),
        });
        serial
    }

    /// The connections still open, each with its key and serial; the closed
    /// ones are dropped from the list.
    pub(crate) fn live(&self) -> Vec<(EndpointId, u64, Connection)> {
        let mut list = self.locked();
        let mut live = Vec::new();
        list.open.retain(|open| match open.conn.upgrade() {
            Some(conn) if conn.close_reason().is_none() => {
                live.push((open.key, open.serial, conn));
                true
            }
            _ => false,
        });
        live
    }

    /// Closes each open connection whose key `allow` no longer lets in:
    /// [`close::REVOKED`] for a revoked device's key, else
    /// [`close::NOT_PAIRED`]. Says how many it closed.
    pub(crate) fn close_unwelcome(&self, allow: &AllowList) -> usize {
        let mut closed = 0;
        for (key, _, conn) in self.live() {
            let (code, reason): (u32, &[u8]) = match allow.standing(&key) {
                Standing::Paired => continue,
                Standing::Revoked => (close::REVOKED, b"this device was revoked"),
                Standing::Unknown => (close::NOT_PAIRED, b"not paired with this host"),
            };
            warn!("{}: closed, no longer on the allow-list", key.fmt_short());
            conn.close(VarInt::from_u32(code), reason);
            closed += 1;
        }
        // Drop what was just closed.
        self.live();
        closed
    }

    fn locked(&self) -> MutexGuard<'_, List> {
        // Every update is one push or one retain, so the list is whole even
        // if a holder panicked.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}
