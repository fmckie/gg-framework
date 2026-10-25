//! The app's side of the link: where the app's HTTP client connects. In the
//! app that's a Unix socket only the app's own process can use
//! ([`Forward::listen_private`]); for tests and the `client` dev tool, a
//! loopback TCP listener. Each connection the client opens becomes one
//! bidirectional stream on the link's connection, copied both ways until both
//! sides have finished. The host's forwarder copies each stream to kleio-host
//! the same way, so the bytes are plain HTTP from end to end. Each stream
//! notes when the app last sent bytes on it and tells the link each time bytes
//! come back, so the link can time a resume to the first reply to a request
//! sent after it.

use std::io;
use std::net::{Ipv4Addr, SocketAddr};
#[cfg(unix)]
use std::path::Path;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpListener;
#[cfg(unix)]
use tokio::net::{UnixListener, UnixStream};
use tracing::{debug, warn};

use crate::link::Link;

/// The pause after a failed accept (out of file descriptors, say), so that
/// the loop doesn't spin.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);
/// How long [`Forward::listening`] waits for loopback to answer. It answers
/// at once either way unless the listener's backlog is full.
#[cfg(unix)]
const PROBE_TIMEOUT: Duration = Duration::from_millis(100);
/// The most a connection's first read takes: enough to tell it's sending,
/// and usually its whole request head.
const FIRST_READ: usize = 8 * 1024;

/// The longest path a Unix socket can have, in bytes: `sun_path` holds 108
/// on Linux and 104 elsewhere (Apple's systems among them), the last a NUL.
#[cfg(target_os = "linux")]
pub const SOCKET_PATH_MAX: usize = 107;
#[cfg(all(unix, not(target_os = "linux")))]
pub const SOCKET_PATH_MAX: usize = 103;

/// What the forwarder listens on.
enum Listener {
    /// Loopback TCP: tests and the `client` dev tool.
    Tcp(TcpListener),
    /// The app's private socket.
    #[cfg(unix)]
    Private(UnixListener),
}

/// The listener, and the link it forwards to.
pub struct Forward {
    listener: Listener,
    link: Link,
}

impl Forward {
    /// Listens on `127.0.0.1:port`; 0 picks a free port. Loopback only, so
    /// nothing else on the network can send through the link.
    pub async fn bind(port: u16, link: Link) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await?;
        Ok(Self {
            listener: Listener::Tcp(listener),
            link,
        })
    }

    /// Listens on `127.0.0.1:port` now, before the link exists and without a
    /// runtime. Connections made to it wait in its backlog, their requests
    /// with them, until [`from_std`](Self::from_std) forwards on it: an app
    /// can listen before anything can send to the link, and dial later.
    pub fn listen(port: u16) -> io::Result<std::net::TcpListener> {
        std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port))
    }

    /// Whether something still listens on `127.0.0.1:port`. iOS can take a
    /// suspended app's listening socket away (Apple's TN2277), and the socket
    /// never says so: connecting to it is just refused. This connects and
    /// closes at once without sending anything, which [`run`](Self::run)
    /// passes on as nothing at all. It blocks for at most 100 ms.
    ///
    /// Unix only. Windows retries a refused loopback connection for about a
    /// second before it says so, so a 100 ms check there can't tell a port
    /// nothing listens on from a slow listener.
    #[cfg(unix)]
    pub fn listening(port: u16) -> bool {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        match std::net::TcpStream::connect_timeout(&addr, PROBE_TIMEOUT) {
            Ok(_) => true,
            Err(err) => !matches!(
                err.kind(),
                io::ErrorKind::ConnectionRefused | io::ErrorKind::ConnectionReset
            ),
        }
    }

    /// Forwards on a listener from [`listen`](Self::listen), connections
    /// already waiting included. Refuses one that isn't on loopback. Call it
    /// within the runtime.
    pub fn from_std(listener: std::net::TcpListener, link: Link) -> io::Result<Self> {
        on_loopback(listener.local_addr()?)?;
        listener.set_nonblocking(true)?;
        let listener = TcpListener::from_std(listener)?;
        Ok(Self {
            listener: Listener::Tcp(listener),
            link,
        })
    }

    /// Listens on a socket at `path` that only this process can use, now,
    /// before the link exists and without a runtime, as
    /// [`listen`](Self::listen) does on loopback. The socket is 0600, in a
    /// folder of its own made 0700, and [`run`](Self::run) forwards only
    /// connections from this process. A socket left at `path` that nothing
    /// listens on (by a launch that has ended, or one iOS took away) is
    /// replaced; one something still listens on isn't. Refuses a path over
    /// [`SOCKET_PATH_MAX`] bytes.
    #[cfg(unix)]
    pub fn listen_private(path: &Path) -> io::Result<std::os::unix::net::UnixListener> {
        use std::os::unix::fs::{DirBuilderExt, FileTypeExt, PermissionsExt};

        let length = path.as_os_str().len();
        if length > SOCKET_PATH_MAX {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "the link's socket path is {length} bytes, over the {SOCKET_PATH_MAX} a \
                     socket's can be: {}",
                    path.display()
                ),
            ));
        }
        let folder = path
            .parent()
            .filter(|folder| !folder.as_os_str().is_empty())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("the link's socket needs a folder: {}", path.display()),
                )
            })?;
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(folder)?;
        // One made before may let others in.
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o700))?;
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_socket() => {
                if Self::listening_private(path) {
                    return Err(io::Error::new(
                        io::ErrorKind::AddrInUse,
                        format!("something already listens on {}", path.display()),
                    ));
                }
                std::fs::remove_file(path)?;
            }
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    format!("{} is there, and isn't a socket", path.display()),
                ));
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return Err(err),
        }
        let listener = std::os::unix::net::UnixListener::bind(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        Ok(listener)
    }

    /// Whether something still listens on the socket at `path`, as
    /// [`listening`](Self::listening) tells for a port: it connects and
    /// closes at once without sending anything, which [`run`](Self::run)
    /// passes on as nothing at all. Unless the listener's backlog is full, it
    /// answers at once.
    #[cfg(unix)]
    pub fn listening_private(path: &Path) -> bool {
        match std::os::unix::net::UnixStream::connect(path) {
            Ok(_) => true,
            Err(err) => !matches!(
                err.kind(),
                io::ErrorKind::ConnectionRefused
                    | io::ErrorKind::ConnectionReset
                    | io::ErrorKind::NotFound
            ),
        }
    }

    /// Forwards on a listener from [`listen_private`](Self::listen_private),
    /// connections already waiting included, from this process only. Call it
    /// within the runtime.
    #[cfg(unix)]
    pub fn from_std_private(
        listener: std::os::unix::net::UnixListener,
        link: Link,
    ) -> io::Result<Self> {
        listener.set_nonblocking(true)?;
        let listener = UnixListener::from_std(listener)?;
        Ok(Self {
            listener: Listener::Private(listener),
            link,
        })
    }

    /// [`listen_private`](Self::listen_private), then
    /// [`from_std_private`](Self::from_std_private). Call it within the
    /// runtime.
    #[cfg(unix)]
    pub fn bind_private(path: &Path, link: Link) -> io::Result<Self> {
        Self::from_std_private(Self::listen_private(path)?, link)
    }

    /// Where the TCP listener is. The private socket has no address.
    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        match &self.listener {
            Listener::Tcp(listener) => listener.local_addr(),
            #[cfg(unix)]
            Listener::Private(_) => Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "the link's private socket has no IP address",
            )),
        }
    }

    /// Forwards connections until the task running this is dropped or
    /// aborted. On the private socket, only this process's.
    pub async fn run(self) {
        let Self { listener, link } = self;
        match listener {
            Listener::Tcp(listener) => loop {
                match listener.accept().await {
                    Ok((tcp, _)) => {
                        // Small writes, such as one event of a stream, go out
                        // at once instead of waiting on Nagle's algorithm. The
                        // field tests time them.
                        if let Err(err) = tcp.set_nodelay(true) {
                            debug!("couldn't turn off Nagle's algorithm: {err}");
                        }
                        tokio::spawn(forward(tcp, link.clone()));
                    }
                    Err(err) => {
                        warn!("loopback accept failed: {err}");
                        tokio::time::sleep(ACCEPT_RETRY).await;
                    }
                }
            },
            #[cfg(unix)]
            Listener::Private(listener) => loop {
                match listener.accept().await {
                    Ok((stream, _)) => match from_this_process(&stream) {
                        Ok(true) => {
                            tokio::spawn(forward(stream, link.clone()));
                        }
                        Ok(false) => {
                            warn!("turned away a connection to the link's socket from another process");
                        }
                        // Closed already, say: turned away all the same.
                        Err(err) => {
                            debug!("turned away a connection to the link's socket: can't tell its process: {err}");
                        }
                    },
                    Err(err) => {
                        warn!("the link's socket: accept failed: {err}");
                        tokio::time::sleep(ACCEPT_RETRY).await;
                    }
                }
            },
        }
    }
}

/// Whether the other end of `stream` is this process: the app's own HTTP
/// client. The socket's modes keep other users out; this keeps out the
/// user's other programs.
#[cfg(unix)]
fn from_this_process(stream: &UnixStream) -> io::Result<bool> {
    let pid = stream.peer_cred()?.pid();
    Ok(pid.and_then(|pid| u32::try_from(pid).ok()) == Some(std::process::id()))
}

/// Only on loopback, so nothing else on the network can send through the
/// link.
fn on_loopback(addr: SocketAddr) -> io::Result<()> {
    if addr.ip().is_loopback() {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("the link listens on loopback only, not on {addr}"),
        ))
    }
}

/// One connection from the app, over one stream.
async fn forward<S: AsyncRead + AsyncWrite + Unpin>(mut app: S, link: Link) {
    // Nothing goes to the host before the app sends something: a connection
    // closed without a byte, such as a `listening` check, dials nothing and
    // opens no stream. (HTTP's client always speaks first.)
    let mut first = vec![0; FIRST_READ];
    let read = match app.read(&mut first).await {
        Ok(0) => return,
        Ok(read) => read,
        Err(err) => {
            debug!("dropped a connection before it sent anything: {err}");
            return;
        }
    };
    let conn = match link.connection().await {
        Ok(conn) => conn,
        // The link has logged the failed dial. Dropping the app's connection
        // tells its HTTP client.
        Err(err) => {
            debug!("dropped a connection: {err}");
            return;
        }
    };
    let (send, recv) = match conn.open_bi().await {
        Ok(stream) => stream,
        Err(err) => {
            warn!("couldn't open a stream: {err}");
            return;
        }
    };
    let mut stream = HostStream::new(recv, send, link);
    if let Err(err) = stream.write_all(&first[..read]).await {
        debug!("stream ended: {err}");
        return;
    }
    match tokio::io::copy_bidirectional(&mut app, &mut stream).await {
        Ok((sent, received)) => {
            let sent = sent.saturating_add(u64::try_from(read).unwrap_or(u64::MAX));
            debug!("stream finished: sent {sent} B, received {received} B")
        }
        Err(err) => debug!("stream ended: {err}"),
    }
}

/// One stream to the host, as the app's connection sees it. It notes the
/// link's resume number each time the app sends bytes on it, and passes that
/// note to the link each time bytes come back, so only a reply to a request
/// sent after a resume began can end it.
struct HostStream<R, W> {
    recv: R,
    send: W,
    link: Link,
    /// The resume during which the app last sent bytes here; 0 for none yet.
    sent_in: u64,
}

impl<R, W> HostStream<R, W> {
    fn new(recv: R, send: W, link: Link) -> Self {
        Self {
            recv,
            send,
            link,
            sent_in: 0,
        }
    }
}

impl<R: AsyncRead + Unpin, W: Unpin> AsyncRead for HostStream<R, W> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let before = buf.filled().len();
        let polled = Pin::new(&mut this.recv).poll_read(cx, buf);
        if buf.filled().len() > before {
            this.link.bytes_from_host(this.sent_in);
        }
        polled
    }
}

impl<R: Unpin, W: AsyncWrite + Unpin> AsyncWrite for HostStream<R, W> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        let polled = Pin::new(&mut this.send).poll_write(cx, buf);
        // Bytes went out: what comes back from here on answers them.
        if matches!(polled, Poll::Ready(Ok(sent)) if sent > 0) {
            this.sent_in = this.link.resume_number();
        }
        polled
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().send).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().send).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use iroh::endpoint::{Connection, VarInt};
    use iroh::Endpoint;
    use tokio::net::TcpStream;
    use tokio::sync::mpsc;

    use super::*;
    use crate::paths::PathEvents;
    use crate::testing::{loopback_addr, loopback_endpoint, within_30_s};
    #[cfg(unix)]
    use crate::testing::{mode, TempDir};
    use crate::ALPN_HTTP;

    /// A host that echoes every stream of every connection, and hands the
    /// test each connection it accepts.
    async fn echo_host(endpoint: Endpoint, accepted: mpsc::UnboundedSender<Connection>) {
        while let Some(incoming) = endpoint.accept().await {
            let Ok(conn) = incoming.await else { continue };
            accepted.send(conn.clone()).expect("the test is listening");
            tokio::spawn(async move {
                while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                    tokio::spawn(async move {
                        tokio::io::copy(&mut recv, &mut send).await.expect("echoes");
                        send.finish().expect("finishes");
                    });
                }
            });
        }
    }

    /// Sends `body` on a new TCP connection, half-closes it, and reads
    /// everything that comes back.
    async fn round_trip(addr: SocketAddr, body: &[u8]) -> Vec<u8> {
        let mut tcp = TcpStream::connect(addr).await.expect("connects");
        tcp.write_all(body).await.expect("writes");
        tcp.shutdown().await.expect("half-closes");
        let mut back = Vec::new();
        tcp.read_to_end(&mut back).await.expect("reads");
        back
    }

    /// A host that answers each stream as it reads it: each chunk the app
    /// sends comes straight back as its reply, and the test hears when it's on
    /// its way.
    async fn answering_host(endpoint: Endpoint, answered: mpsc::UnboundedSender<()>) {
        while let Some(incoming) = endpoint.accept().await {
            let Ok(conn) = incoming.await else { continue };
            let answered = answered.clone();
            tokio::spawn(async move {
                while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                    let answered = answered.clone();
                    tokio::spawn(async move {
                        let mut chunk = [0; 1024];
                        // Until the app finishes the stream, or the test ends
                        // and drops it.
                        while let Ok(read @ 1..) = AsyncReadExt::read(&mut recv, &mut chunk).await {
                            if AsyncWriteExt::write_all(&mut send, &chunk[..read])
                                .await
                                .is_err()
                            {
                                return;
                            }
                            // The test may have stopped listening.
                            let _ = answered.send(());
                        }
                        let _ = send.finish();
                    });
                }
            });
        }
    }

    #[tokio::test]
    async fn forwards_each_tcp_connection_over_its_own_stream_and_redials() {
        within_30_s(async {
            let host = loopback_endpoint(1, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(2, &[]).await;
            let (accepted_tx, mut accepted) = mpsc::unbounded_channel();
            tokio::spawn(echo_host(host.clone(), accepted_tx));

            let link = Link::new(phone, loopback_addr(&host).into());
            let forward = Forward::bind(0, link.clone()).await.expect("binds");
            let addr = forward.local_addr().expect("has an address");
            assert!(addr.ip().is_loopback());
            tokio::spawn(forward.run());

            // Two TCP connections: two streams on one connection.
            let request = b"GET /kleio/health HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n";
            assert_eq!(round_trip(addr, request).await, request);
            assert_eq!(round_trip(addr, b"second").await, b"second");
            let first = accepted.recv().await.expect("the host accepted");
            assert!(accepted.try_recv().is_err(), "a second connection");
            assert_eq!(link.status().redials, 0);

            // The host drops the connection; the next request dials again.
            let phone_side = link.connection().await.expect("still open");
            first.close(VarInt::from_u32(0), b"test");
            phone_side.closed().await;
            assert!(!link.status().connected);
            assert_eq!(round_trip(addr, b"third").await, b"third");
            accepted.recv().await.expect("the host accepted again");
            let status = link.status();
            assert!(status.connected);
            assert_eq!(status.redials, 1);
        })
        .await;
    }

    #[tokio::test]
    async fn says_which_path_keeps_its_events_and_times_a_resume() {
        within_30_s(async {
            let host = loopback_endpoint(3, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(4, &[]).await;
            let (accepted_tx, mut accepted) = mpsc::unbounded_channel();
            tokio::spawn(echo_host(host.clone(), accepted_tx));

            let events = PathEvents::new(20);
            let link = Link::with_path_events(phone, loopback_addr(&host).into(), events.clone());
            let forward = Forward::bind(0, link.clone()).await.expect("binds");
            let addr = forward.local_addr().expect("has an address");
            tokio::spawn(forward.run());
            assert_eq!(link.path(), None, "no connection yet");
            assert_eq!(link.last_resume(), None);

            // Back on screen: the first byte back ends the resume.
            link.begin_resume();
            assert_eq!(round_trip(addr, b"after a resume").await, b"after a resume");
            assert!(link.last_resume().is_some(), "the resume was timed");

            // Loopback endpoints have no relay, so the path is direct.
            let path = link.path().expect("an open path");
            assert!(path.direct, "{path:?}");
            let direct: SocketAddr = path.addr.parse().expect("an ip:port");
            assert!(direct.ip().is_loopback(), "{path:?}");
            let lines = events.lines();
            let first = lines.first().expect("the connection was kept");
            assert!(first.text.contains(" connected: "), "{first:?}");

            // The host drops it: no path now, and the close is kept too.
            let phone_side = link.connection().await.expect("still open");
            let host_side = accepted.recv().await.expect("the host accepted");
            host_side.close(VarInt::from_u32(0), b"test");
            phone_side.closed().await;
            assert_eq!(link.path(), None);
            while !events
                .lines()
                .iter()
                .any(|line| line.text.contains(" connection closed: "))
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
    }

    #[tokio::test]
    async fn reading_an_old_reply_after_a_resume_doesnt_end_it() {
        within_30_s(async {
            let host = loopback_endpoint(5, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(6, &[]).await;
            let (answered_tx, mut answered) = mpsc::unbounded_channel();
            tokio::spawn(answering_host(host.clone(), answered_tx));
            let link = Link::new(phone, loopback_addr(&host).into());
            let forward = Forward::bind(0, link.clone()).await.expect("binds");
            let addr = forward.local_addr().expect("has an address");
            tokio::spawn(forward.run());

            // A stream, as the forwarder makes them: its request goes out and
            // its reply is sent but left unread, as when the app was suspended
            // while a reply came in.
            let conn = link.connection().await.expect("dials");
            let (send, recv) = conn.open_bi().await.expect("opens a stream");
            let mut old = HostStream::new(recv, send, link.clone());
            old.write_all(b"before").await.expect("sends");
            answered.recv().await.expect("the host replied");

            // Back on screen: reading that reply now leaves the timer running.
            link.begin_resume();
            let mut reply = [0; 6];
            old.read_exact(&mut reply)
                .await
                .expect("reads the old reply");
            assert_eq!(&reply, b"before");
            assert_eq!(link.last_resume(), None, "the old reply stopped the timer");

            // The first reply to a new request stops it, timed from the resume.
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert_eq!(round_trip(addr, b"after").await, b"after");
            let took = link.last_resume().expect("the new reply stopped the timer");
            assert!(took >= Duration::from_millis(100), "{took:?}");
        })
        .await;
    }

    #[tokio::test]
    async fn a_request_sent_after_a_resume_ends_it_even_on_an_older_stream() {
        within_30_s(async {
            let host = loopback_endpoint(7, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(8, &[]).await;
            let (answered_tx, _answered) = mpsc::unbounded_channel();
            tokio::spawn(answering_host(host.clone(), answered_tx));
            let link = Link::new(phone, loopback_addr(&host).into());

            // A stream from before the resume, kept as the app's HTTP client
            // keeps an idle connection to the forwarder and reuses it.
            let conn = link.connection().await.expect("dials");
            let (send, recv) = conn.open_bi().await.expect("opens a stream");
            let mut kept = HostStream::new(recv, send, link.clone());
            let mut reply = [0; 5];
            kept.write_all(b"first").await.expect("sends");
            kept.read_exact(&mut reply).await.expect("reads");

            // Back on screen: the reply to a request sent on it now ends the
            // resume.
            link.begin_resume();
            kept.write_all(b"again").await.expect("sends");
            kept.read_exact(&mut reply).await.expect("reads");
            assert_eq!(&reply, b"again");
            assert!(link.last_resume().is_some(), "the resume was timed");
        })
        .await;
    }

    /// An app can listen before the link exists: a connection made then waits
    /// in the backlog, its request with it, and is forwarded once forwarding
    /// starts. Nothing dials the host before that.
    #[tokio::test]
    async fn forwards_connections_made_before_it_started() {
        within_30_s(async {
            let listener = Forward::listen(0).expect("listens");
            let addr = listener.local_addr().expect("has an address");
            assert!(addr.ip().is_loopback());
            // Nothing forwards yet, and the connection and its request are
            // taken all the same.
            let mut early = TcpStream::connect(addr).await.expect("taken at once");
            early.write_all(b"sent early").await.expect("taken at once");
            early.shutdown().await.expect("half-closes");

            let host = loopback_endpoint(9, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(10, &[]).await;
            let (accepted_tx, mut accepted) = mpsc::unbounded_channel();
            tokio::spawn(echo_host(host.clone(), accepted_tx));
            let link = Link::new(phone, loopback_addr(&host).into());
            assert!(accepted.try_recv().is_err(), "dialled before forwarding");
            let forward = Forward::from_std(listener, link).expect("forwards on it");
            assert_eq!(forward.local_addr().expect("has an address"), addr);
            tokio::spawn(forward.run());

            let mut back = Vec::new();
            early.read_to_end(&mut back).await.expect("reads");
            assert_eq!(back, b"sent early");
            accepted
                .recv()
                .await
                .expect("dialled once forwarding started");
        })
        .await;
    }

    /// A connection that closes without sending a byte, as `listening`'s
    /// check does, dials nothing and opens no stream; and once nothing
    /// listens, the check says so (on Unix, the only place it's checked).
    #[tokio::test]
    async fn a_connection_that_sends_nothing_dials_nothing() {
        within_30_s(async {
            let host = loopback_endpoint(11, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(12, &[]).await;
            let (accepted_tx, mut accepted) = mpsc::unbounded_channel();
            tokio::spawn(echo_host(host.clone(), accepted_tx));
            let link = Link::new(phone, loopback_addr(&host).into());
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .await
                .expect("listens");
            let port = listener.local_addr().expect("has an address").port();

            #[cfg(unix)]
            assert!(Forward::listening(port), "it's listening");
            #[cfg(not(unix))]
            drop(std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).expect("connects"));
            let (tcp, _) = listener.accept().await.expect("the check's connection");
            forward(tcp, link.clone()).await;
            assert!(!link.status().connected, "dialled for nothing");
            assert!(accepted.try_recv().is_err(), "the host was dialled");

            drop(listener);
            #[cfg(unix)]
            assert!(!Forward::listening(port), "nothing listens once it's gone");
        })
        .await;
    }

    /// A short socket path, in a folder of the test's own.
    #[cfg(unix)]
    fn socket_in(dir: &TempDir) -> std::path::PathBuf {
        dir.path().join("run").join("l.sock")
    }

    /// Sends `body` on a new connection to the socket at `path`, half-closes
    /// it, and reads everything that comes back.
    #[cfg(unix)]
    async fn round_trip_private(path: &Path, body: &[u8]) -> Vec<u8> {
        let mut stream = UnixStream::connect(path).await.expect("connects");
        stream.write_all(body).await.expect("writes");
        stream.shutdown().await.expect("half-closes");
        let mut back = Vec::new();
        stream.read_to_end(&mut back).await.expect("reads");
        back
    }

    /// The app's socket: 0600 in a 0700 folder, forwarding this process's
    /// connections, those made before forwarding started included.
    #[cfg(unix)]
    #[tokio::test]
    async fn forwards_this_processes_connections_on_its_private_socket() {
        within_30_s(async {
            let dir = TempDir::new("fwd-private");
            let path = socket_in(&dir);
            let listener = Forward::listen_private(&path).expect("listens");
            assert_eq!(mode(path.parent().expect("a folder")), 0o700);
            assert_eq!(mode(&path), 0o600);
            assert!(Forward::listening_private(&path));
            // Taken before anything forwards, and answered once it does.
            let mut early = UnixStream::connect(&path).await.expect("taken at once");
            early.write_all(b"sent early").await.expect("taken at once");
            early.shutdown().await.expect("half-closes");

            let host = loopback_endpoint(13, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(14, &[]).await;
            let (accepted_tx, mut accepted) = mpsc::unbounded_channel();
            tokio::spawn(echo_host(host.clone(), accepted_tx));
            let link = Link::new(phone, loopback_addr(&host).into());
            let forward = Forward::from_std_private(listener, link).expect("forwards on it");
            assert!(forward.local_addr().is_err(), "a socket has no IP address");
            tokio::spawn(forward.run());

            let mut back = Vec::new();
            early.read_to_end(&mut back).await.expect("reads");
            assert_eq!(back, b"sent early");
            assert_eq!(round_trip_private(&path, b"second").await, b"second");
            accepted.recv().await.expect("the host accepted");
            assert!(accepted.try_recv().is_err(), "a second connection");
        })
        .await;
    }

    /// The variable naming the socket [`as_another_process`] connects to.
    #[cfg(unix)]
    const OTHER_PROCESS: &str = "KLEIO_LINK_TEST_OTHER_PROCESS";

    /// Not a test of its own: with [`OTHER_PROCESS`] set, it's another
    /// process connecting to the link's socket, which
    /// `turns_away_a_connection_from_another_process` runs. It sends a
    /// request and says how much came back.
    #[cfg(unix)]
    #[test]
    fn as_another_process() {
        use std::io::{Read, Write};
        let Some(path) = std::env::var_os(OTHER_PROCESS) else {
            return;
        };
        let mut stream = std::os::unix::net::UnixStream::connect(path).expect("connects");
        // Turned away, the write may fail and the read be cut short.
        let _ = stream.write_all(b"GET /kleio/health HTTP/1.1\r\nhost: link\r\n\r\n");
        let _ = stream.shutdown(std::net::Shutdown::Write);
        let mut back = Vec::new();
        let _ = stream.read_to_end(&mut back);
        println!("another process got {} bytes back", back.len());
    }

    /// The socket's modes keep other users out; the forwarder turns away the
    /// user's other programs too, before anything is dialled.
    #[cfg(unix)]
    #[tokio::test]
    async fn turns_away_a_connection_from_another_process() {
        within_30_s(async {
            let dir = TempDir::new("fwd-other");
            let path = socket_in(&dir);
            let host = loopback_endpoint(15, &[ALPN_HTTP]).await;
            let phone = loopback_endpoint(16, &[]).await;
            let (accepted_tx, mut accepted) = mpsc::unbounded_channel();
            tokio::spawn(echo_host(host.clone(), accepted_tx));
            let link = Link::new(phone, loopback_addr(&host).into());
            let forward = Forward::bind_private(&path, link.clone()).expect("listens");
            tokio::spawn(forward.run());

            let exe = std::env::current_exe().expect("this test binary");
            let socket = path.clone();
            let out = tokio::task::spawn_blocking(move || {
                std::process::Command::new(exe)
                    .args([
                        "--exact",
                        "forward::tests::as_another_process",
                        "--nocapture",
                        "--test-threads=1",
                    ])
                    .env(OTHER_PROCESS, socket)
                    .output()
            })
            .await
            .expect("runs")
            .expect("the other process ran");
            let said = String::from_utf8_lossy(&out.stdout);
            assert!(out.status.success(), "{out:?}");
            assert!(said.contains("another process got 0 bytes back"), "{said}");
            assert!(accepted.try_recv().is_err(), "the host was dialled");
            assert!(!link.status().connected, "dialled for another process");

            // This process's own connection goes through.
            assert_eq!(round_trip_private(&path, b"mine").await, b"mine");
        })
        .await;
    }

    /// A socket left by a launch that has ended is replaced, and a folder
    /// made before is closed to others; a socket something listens on, or a
    /// file that isn't a socket, is left alone.
    #[cfg(unix)]
    #[test]
    fn replaces_a_socket_nothing_listens_on_and_nothing_else() {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

        let dir = TempDir::new("fwd-stale");
        let path = socket_in(&dir);
        std::fs::DirBuilder::new()
            .mode(0o755)
            .create(path.parent().expect("a folder"))
            .expect("made");
        std::fs::set_permissions(
            path.parent().expect("a folder"),
            std::fs::Permissions::from_mode(0o755),
        )
        .expect("opened up");
        let first = Forward::listen_private(&path).expect("listens");
        assert_eq!(mode(path.parent().expect("a folder")), 0o700);
        let taken = Forward::listen_private(&path).expect_err("something listens");
        assert_eq!(taken.kind(), io::ErrorKind::AddrInUse, "{taken}");

        drop(first);
        assert!(
            path.exists(),
            "the socket file stays when its listener goes"
        );
        assert!(!Forward::listening_private(&path));
        let _again = Forward::listen_private(&path).expect("replaces it");
        assert!(Forward::listening_private(&path));

        let file = dir.path().join("run").join("not-a-socket");
        std::fs::write(&file, b"kept").expect("written");
        let refused = Forward::listen_private(&file).expect_err("not a socket");
        assert_eq!(refused.kind(), io::ErrorKind::AlreadyExists, "{refused}");
        assert_eq!(std::fs::read(&file).expect("still there"), b"kept");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_socket_path_longer_than_a_socket_can_have() {
        let dir = TempDir::new("fwd-long");
        let folder = dir.path().join("run");
        let room = SOCKET_PATH_MAX - folder.as_os_str().len() - 1;
        let longest = folder.join("x".repeat(room));
        assert_eq!(longest.as_os_str().len(), SOCKET_PATH_MAX);
        Forward::listen_private(&longest).expect("the longest path a socket can have");
        let refused =
            Forward::listen_private(&folder.join("x".repeat(room + 1))).expect_err("a byte over");
        assert_eq!(refused.kind(), io::ErrorKind::InvalidInput, "{refused}");
        assert!(
            refused
                .to_string()
                .contains(&format!("over the {SOCKET_PATH_MAX}")),
            "{refused}"
        );
    }

    #[test]
    fn listens_on_loopback_only() {
        for ok in ["127.0.0.1:47821", "[::1]:47821"] {
            assert!(on_loopback(ok.parse().expect("an address")).is_ok(), "{ok}");
        }
        for refused in ["0.0.0.0:47821", "[::]:47821", "192.168.1.2:47821"] {
            let addr = refused.parse().expect("an address");
            assert!(on_loopback(addr).is_err(), "{refused}");
        }
    }
}
