//! The phone's loopback listener. The app's HTTP client talks to
//! `http://127.0.0.1:<port>`; each TCP connection it opens becomes one
//! bidirectional stream on the link's connection, copied both ways until both
//! sides have finished. The host's forwarder copies each stream to kleio-host
//! the same way, so the bytes are plain HTTP from end to end. Each stream
//! notes when the app last sent bytes on it and tells the link each time bytes
//! come back, so the link can time a resume to the first reply to a request
//! sent after it.

use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, warn};

use crate::link::Link;

/// The pause after a failed accept (out of file descriptors, say), so that
/// the loop doesn't spin.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);
/// How long [`Forward::listening`] waits for loopback to answer. It answers
/// at once either way unless the listener's backlog is full.
#[cfg(unix)]
const PROBE_TIMEOUT: Duration = Duration::from_millis(100);

/// The loopback listener, and the link it forwards to.
pub struct Forward {
    listener: TcpListener,
    link: Link,
}

impl Forward {
    /// Listens on `127.0.0.1:port`; 0 picks a free port. Loopback only, so
    /// nothing else on the network can send through the link.
    pub async fn bind(port: u16, link: Link) -> io::Result<Self> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await?;
        Ok(Self { listener, link })
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
        Ok(Self { listener, link })
    }

    /// Where the listener is.
    pub fn local_addr(&self) -> io::Result<SocketAddr> {
        self.listener.local_addr()
    }

    /// Forwards connections until the task running this is dropped or
    /// aborted.
    pub async fn run(self) {
        loop {
            match self.listener.accept().await {
                Ok((tcp, _)) => {
                    tokio::spawn(forward(tcp, self.link.clone()));
                }
                Err(err) => {
                    warn!("loopback accept failed: {err}");
                    tokio::time::sleep(ACCEPT_RETRY).await;
                }
            }
        }
    }
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

/// One TCP connection, over one stream.
async fn forward(mut tcp: TcpStream, link: Link) {
    // Small writes, such as one event of a stream, go out at once instead of
    // waiting on Nagle's algorithm. The field tests time them.
    if let Err(err) = tcp.set_nodelay(true) {
        debug!("couldn't turn off Nagle's algorithm: {err}");
    }
    // Nothing goes to the host before the app sends something: a connection
    // closed without a byte, such as `Forward::listening` checking the
    // listener, dials nothing and opens no stream. (HTTP's client always
    // speaks first.)
    match tcp.peek(&mut [0; 1]).await {
        Ok(0) => return,
        Ok(_) => {}
        Err(err) => {
            debug!("dropped a connection before it sent anything: {err}");
            return;
        }
    }
    let conn = match link.connection().await {
        Ok(conn) => conn,
        // The link has logged the failed dial. Dropping the TCP connection
        // tells the app's HTTP client.
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
    match tokio::io::copy_bidirectional(&mut tcp, &mut stream).await {
        Ok((sent, received)) => {
            debug!("stream finished: sent {sent} B, received {received} B")
        }
        Err(err) => debug!("stream ended: {err}"),
    }
}

/// One stream to the host, as the app's TCP connection sees it. It notes the
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
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc;

    use super::*;
    use crate::paths::PathEvents;
    use crate::testing::{loopback_addr, loopback_endpoint, within_30_s};
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

            let link = Link::new(phone, loopback_addr(&host));
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
            let link = Link::with_path_events(phone, loopback_addr(&host), events.clone());
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
            assert!(!path.tailscale, "{path:?}");
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
            let link = Link::new(phone, loopback_addr(&host));
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
            let link = Link::new(phone, loopback_addr(&host));

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
            let link = Link::new(phone, loopback_addr(&host));
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
            let link = Link::new(phone, loopback_addr(&host));
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
