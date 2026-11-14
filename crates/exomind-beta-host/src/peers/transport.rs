use super::{BetaHost, HostError, Identity, Lease, Session, identity};
use rustls::{
    ClientConfig, DigitallySignedStruct, DistinguishedName, Error, ProtocolVersion, ServerConfig,
    SignatureScheme,
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, SubjectPublicKeyInfoDer, UnixTime},
    server::danger::{ClientCertVerified, ClientCertVerifier},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{OwnedSemaphorePermit, mpsc, oneshot, watch},
};
const ALPN: &[u8] = b"exomind-peer-transport/1";
const MAX_FRAME: usize = 256 * 1024;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct PeerPin([u8; 32]);
impl PeerPin {
    pub fn from_sha256(value: &str) -> Result<Self, HostError> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(HostError::InvalidRequest);
        }
        let mut bytes = [0u8; 32];
        for (i, pair) in value.as_bytes().chunks_exact(2).enumerate() {
            let nibble = |b: u8| if b <= b'9' { b - b'0' } else { b - b'a' + 10 };
            bytes[i] = nibble(pair[0]) * 16 + nibble(pair[1]);
        }
        Ok(Self(bytes))
    }
    pub fn as_sha256(&self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }
    fn of(spki: &[u8]) -> Self {
        Self(Sha256::digest(spki).into())
    }
}
#[derive(Clone)]
pub struct PeerCancellation {
    flag: watch::Sender<bool>,
}
impl Default for PeerCancellation {
    fn default() -> Self {
        Self::new()
    }
}
impl PeerCancellation {
    pub fn new() -> Self {
        let (flag, _) = watch::channel(false);
        Self { flag }
    }
    pub fn cancel(&self) {
        self.flag.send_replace(true);
    }
    pub(super) fn is_cancelled(&self) -> bool {
        *self.flag.borrow()
    }
    async fn cancelled(&self) {
        let mut state = self.flag.subscribe();
        loop {
            if *state.borrow_and_update() {
                return;
            }
            if state.changed().await.is_err() {
                return;
            }
        }
    }
}
#[derive(Debug, Clone, Copy)]
pub struct PeerTransportOptions {
    pub handshake_timeout: Duration,
    pub channel_lifetime: Duration,
}
impl Default for PeerTransportOptions {
    fn default() -> Self {
        Self {
            handshake_timeout: Duration::from_secs(3),
            channel_lifetime: Duration::from_secs(60),
        }
    }
}
impl PeerTransportOptions {
    fn validate(&self) -> Result<(), HostError> {
        if self.handshake_timeout < Duration::from_millis(50)
            || self.handshake_timeout > Duration::from_secs(30)
            || self.channel_lifetime < Duration::from_millis(50)
            || self.channel_lifetime > Duration::from_secs(300)
        {
            return Err(HostError::InvalidRequest);
        }
        Ok(())
    }
}

#[derive(Debug)]
struct Verifier {
    pin: Option<PeerPin>,
    mismatch: Arc<AtomicBool>,
    provider: Arc<rustls::crypto::CryptoProvider>,
}
impl Verifier {
    fn key(
        &self,
        cert: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
    ) -> Result<(), Error> {
        if !identity::valid_spki(cert.as_ref()) || !intermediates.is_empty() {
            return Err(Error::General("invalid peer raw public key".into()));
        }
        if self
            .pin
            .is_some_and(|pin| pin != PeerPin::of(cert.as_ref()))
        {
            self.mismatch.store(true, Ordering::Release);
            return Err(Error::General("peer pin mismatch".into()));
        }
        Ok(())
    }
    fn signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        rustls::crypto::verify_tls13_signature_with_raw_key(
            message,
            &SubjectPublicKeyInfoDer::from(cert.as_ref()),
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }
}
impl ServerCertVerifier for Verifier {
    fn verify_server_cert(
        &self,
        cert: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        self.key(cert, intermediates)?;
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Err(Error::General("TLS 1.3 required".into()))
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.signature(message, cert, signature)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![SignatureScheme::ED25519]
    }
    fn requires_raw_public_keys(&self) -> bool {
        true
    }
}
impl ClientCertVerifier for Verifier {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }
    fn verify_client_cert(
        &self,
        cert: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _: UnixTime,
    ) -> Result<ClientCertVerified, Error> {
        self.key(cert, intermediates)?;
        Ok(ClientCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Err(Error::General("TLS 1.3 required".into()))
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        self.signature(message, cert, signature)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![SignatureScheme::ED25519]
    }
    fn requires_raw_public_keys(&self) -> bool {
        true
    }
}
fn server_config(identity: &Identity) -> Result<Arc<ServerConfig>, HostError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(Verifier {
        pin: None,
        mismatch: Arc::new(AtomicBool::new(false)),
        provider: provider.clone(),
    });
    let mut config = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| HostError::PeerTls)?
        .with_client_cert_verifier(verifier)
        .with_cert_resolver(Arc::new(
            rustls::server::AlwaysResolvesServerRawPublicKeys::new(identity.certified.clone()),
        ));
    config.alpn_protocols = vec![ALPN.to_vec()];
    config.send_tls13_tickets = 0;
    config.max_early_data_size = 0;
    Ok(Arc::new(config))
}
fn client_config(
    identity: &Identity,
    pin: PeerPin,
    mismatch: Arc<AtomicBool>,
) -> Result<Arc<ClientConfig>, HostError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(Verifier {
        pin: Some(pin),
        mismatch,
        provider: provider.clone(),
    });
    let mut config = ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| HostError::PeerTls)?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_client_cert_resolver(Arc::new(
            rustls::client::AlwaysResolvesClientRawPublicKeys::new(identity.certified.clone()),
        ));
    config.alpn_protocols = vec![ALPN.to_vec()];
    config.enable_early_data = false;
    config.resumption = rustls::client::Resumption::disabled();
    Ok(Arc::new(config))
}

// This value proves only TLS signature/key possession. It has no device UUID,
// profile, member epoch, grant or conversion into the local Session type.
struct VerifiedTransportPeer {
    pin: PeerPin,
}
fn verified(
    stream: &tokio_rustls::TlsStream<TcpStream>,
) -> Result<VerifiedTransportPeer, HostError> {
    let connection = stream.get_ref().1;
    if connection.protocol_version() != Some(ProtocolVersion::TLSv1_3)
        || connection.alpn_protocol() != Some(ALPN)
    {
        return Err(HostError::PeerTls);
    }
    let keys = connection.peer_certificates().ok_or(HostError::PeerTls)?;
    if keys.len() != 1 || !identity::valid_spki(keys[0].as_ref()) {
        return Err(HostError::PeerTls);
    }
    Ok(VerifiedTransportPeer {
        pin: PeerPin::of(keys[0].as_ref()),
    })
}
async fn bounded<T>(
    global: &PeerCancellation,
    scope: &PeerCancellation,
    own: &PeerCancellation,
    limit: Duration,
    action: impl Future<Output = Result<T, HostError>>,
) -> Result<T, HostError> {
    tokio::select! {biased;_=global.cancelled()=>Err(HostError::Stopped),_=scope.cancelled()=>Err(HostError::PeerCancelled),_=own.cancelled()=>Err(HostError::PeerCancelled),result=tokio::time::timeout(limit,action)=>result.map_err(|_|HostError::PeerTimeout)?}
}
enum Request {
    Send(Vec<u8>, oneshot::Sender<Result<(), HostError>>),
    Read(oneshot::Sender<Result<Vec<u8>, HostError>>),
}
pub struct PeerChannel {
    host: Arc<BetaHost>,
    owner: Session,
    peer: VerifiedTransportPeer,
    requests: mpsc::Sender<Request>,
    own: PeerCancellation,
    done: PeerCancellation,
    options: PeerTransportOptions,
}
impl PeerChannel {
    pub fn peer_fingerprint(&self) -> PeerPin {
        self.peer.pin
    }
    pub fn tls_version(&self) -> &'static str {
        "TLS1.3"
    }
    pub async fn close(self) -> Result<(), HostError> {
        self.own.cancel();
        tokio::time::timeout(self.options.handshake_timeout, self.done.cancelled())
            .await
            .map_err(|_| HostError::PeerTimeout)
    }
    // Only the future Host membership layer may use frames. No public admin,
    // raw-source or business API is attached to a possession-only channel.
    pub(crate) async fn send_frame(&self, bytes: Vec<u8>) -> Result<(), HostError> {
        self.host.qualify_transport(&self.owner)?;
        if bytes.len() > MAX_FRAME {
            return Err(HostError::PayloadTooLarge);
        }
        let (reply, receive) = oneshot::channel();
        self.requests
            .send(Request::Send(bytes, reply))
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        let result = receive
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        self.host.qualify_transport(&self.owner)?;
        result
    }
    pub(crate) async fn read_frame(&self) -> Result<Vec<u8>, HostError> {
        self.host.qualify_transport(&self.owner)?;
        let (reply, receive) = oneshot::channel();
        self.requests
            .send(Request::Read(reply))
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        let result = receive
            .await
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        self.host.qualify_transport(&self.owner)?;
        result
    }
}
impl Drop for PeerChannel {
    fn drop(&mut self) {
        self.own.cancel();
    }
}
// Keep resource ownership through every admission failure as well as the
// successful channel. A completed TLS handshake can still fail ALPN/runtime
// validation; reporting that failure must consume the same bounded budget.
struct ConnectionOwnership {
    _permit: OwnedSemaphorePermit,
    _lease: Lease,
}
struct ChannelAdmissionFailure {
    error: HostError,
    ownership: ConnectionOwnership,
}
fn channel(
    host: Arc<BetaHost>,
    owner: Session,
    mut stream: tokio_rustls::TlsStream<TcpStream>,
    scope: PeerCancellation,
    options: PeerTransportOptions,
    ownership: ConnectionOwnership,
) -> Result<PeerChannel, ChannelAdmissionFailure> {
    let peer = match host
        .qualify_transport(&owner)
        .and_then(|()| verified(&stream))
    {
        Ok(peer) => peer,
        Err(error) => return Err(ChannelAdmissionFailure { error, ownership }),
    };
    let (put, mut requests) = mpsc::channel(1);
    let own = PeerCancellation::new();
    let done = PeerCancellation::new();
    let runtime = host.peers.clone();
    let global = runtime.cancel.clone();
    let kill = own.clone();
    let finished = done.clone();
    let held_host = host.clone();
    tokio::spawn(async move {
        let expires = tokio::time::Instant::now() + options.channel_lifetime;
        loop {
            let request = tokio::select! {biased;_=global.cancelled()=>break,_=scope.cancelled()=>break,_=kill.cancelled()=>break,_=tokio::time::sleep_until(expires)=>break,request=requests.recv()=>match request{Some(request)=>request,None=>break}};
            let limit = options
                .handshake_timeout
                .min(expires.saturating_duration_since(tokio::time::Instant::now()));
            match request {
                Request::Send(bytes, reply) => {
                    let result = bounded(&global, &scope, &kill, limit, async {
                        stream
                            .write_u32(bytes.len() as u32)
                            .await
                            .map_err(|_| HostError::PeerTransportUnavailable)?;
                        stream
                            .write_all(&bytes)
                            .await
                            .map_err(|_| HostError::PeerTransportUnavailable)?;
                        stream
                            .flush()
                            .await
                            .map_err(|_| HostError::PeerTransportUnavailable)
                    })
                    .await;
                    let failed = result.is_err();
                    let _ = reply.send(result);
                    if failed {
                        break;
                    }
                }
                Request::Read(reply) => {
                    let result = bounded(&global, &scope, &kill, limit, async {
                        let length = stream
                            .read_u32()
                            .await
                            .map_err(|_| HostError::PeerTransportUnavailable)?
                            as usize;
                        if length > MAX_FRAME {
                            return Err(HostError::PayloadTooLarge);
                        }
                        let mut bytes = vec![0; length];
                        stream
                            .read_exact(&mut bytes)
                            .await
                            .map_err(|_| HostError::PeerTransportUnavailable)?;
                        Ok(bytes)
                    })
                    .await;
                    let failed = result.is_err();
                    let _ = reply.send(result);
                    if failed {
                        break;
                    }
                }
            }
        }
        drop(stream);
        drop(ownership);
        drop(held_host);
        finished.cancel();
    });
    Ok(PeerChannel {
        host,
        owner,
        peer,
        requests: put,
        own,
        done,
        options,
    })
}
pub struct PeerTransportListener {
    host: Arc<BetaHost>,
    owner: Session,
    address: SocketAddr,
    accepted: mpsc::Receiver<Result<PeerChannel, HostError>>,
    cancel: PeerCancellation,
    options: PeerTransportOptions,
}
impl PeerTransportListener {
    pub fn addr(&self) -> SocketAddr {
        self.address
    }
    pub async fn accept(&mut self, cancel: PeerCancellation) -> Result<PeerChannel, HostError> {
        self.host.qualify_transport(&self.owner)?;
        let result = bounded(
            &self.host.peers.cancel,
            &self.cancel,
            &cancel,
            self.options.handshake_timeout,
            async {
                self.accepted
                    .recv()
                    .await
                    .ok_or(HostError::PeerTransportUnavailable)?
            },
        )
        .await;
        self.host.qualify_transport(&self.owner)?;
        result
    }
}
impl Drop for PeerTransportListener {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
impl BetaHost {
    pub async fn listen_peer_transport(
        self: &Arc<Self>,
        owner: &Session,
        address: SocketAddr,
        options: PeerTransportOptions,
    ) -> Result<PeerTransportListener, HostError> {
        options.validate()?;
        self.qualify_transport(owner)?;
        let host = self.clone();
        let session = owner.clone();
        let identity = tokio::task::spawn_blocking(move || host.transport_identity(&session))
            .await
            .map_err(|_| HostError::StatePoisoned)??;
        self.qualify_transport(owner)?;
        let config = server_config(&identity)?;
        let lease = self.peers.register(true)?;
        let cancel = PeerCancellation::new();
        let socket = bounded(
            &self.peers.cancel,
            &cancel,
            &PeerCancellation::new(),
            options.handshake_timeout,
            async {
                TcpListener::bind(address)
                    .await
                    .map_err(|_| HostError::PeerTransportUnavailable)
            },
        )
        .await?;
        let address = socket
            .local_addr()
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        self.qualify_transport(owner)?;
        let (put, accepted) = mpsc::channel(1);
        let host = self.clone();
        let session = owner.clone();
        let stop = cancel.clone();
        tokio::spawn(async move {
            loop {
                let stream = tokio::select! {biased;_=host.peers.cancel.cancelled()=>break,_=stop.cancelled()=>break,result=socket.accept()=>match result{Ok((stream,_))=>stream,Err(_)=>break}};
                let Ok(permit) = host.peers.connections.clone().try_acquire_owned() else {
                    drop(stream);
                    continue;
                };
                let Ok(connection) = host.peers.register(false) else {
                    drop(stream);
                    break;
                };
                let host = host.clone();
                let owner = session.clone();
                let stop = stop.clone();
                let sender = put.clone();
                let acceptor = tokio_rustls::TlsAcceptor::from(config.clone());
                tokio::spawn(async move {
                    let result = bounded(
                        &host.peers.cancel,
                        &stop,
                        &PeerCancellation::new(),
                        options.handshake_timeout,
                        async {
                            acceptor
                                .accept(stream)
                                .await
                                .map_err(|_| HostError::PeerTls)
                        },
                    )
                    .await;
                    let ownership = ConnectionOwnership {
                        _permit: permit,
                        _lease: connection,
                    };
                    let (result, failed_ownership) = match result {
                        Ok(stream) => match channel(
                            host.clone(),
                            owner,
                            stream.into(),
                            stop.clone(),
                            options,
                            ownership,
                        ) {
                            Ok(channel) => (Ok(channel), None),
                            Err(failure) => (Err(failure.error), Some(failure.ownership)),
                        },
                        Err(error) => (Err(error), Some(ownership)),
                    };
                    let _ = bounded(
                        &host.peers.cancel,
                        &stop,
                        &PeerCancellation::new(),
                        options.handshake_timeout,
                        async {
                            sender
                                .send(result)
                                .await
                                .map_err(|_| HostError::PeerTransportUnavailable)
                        },
                    )
                    .await;
                    drop(failed_ownership);
                });
            }
            drop(socket);
            drop(lease);
        });
        Ok(PeerTransportListener {
            host: self.clone(),
            owner: owner.clone(),
            address,
            accepted,
            cancel,
            options,
        })
    }
    pub async fn connect_peer_transport(
        self: &Arc<Self>,
        owner: &Session,
        address: SocketAddr,
        expected_server: PeerPin,
        options: PeerTransportOptions,
        cancel: PeerCancellation,
    ) -> Result<PeerChannel, HostError> {
        options.validate()?;
        self.qualify_transport(owner)?;
        let host = self.clone();
        let session = owner.clone();
        let identity = tokio::task::spawn_blocking(move || host.transport_identity(&session))
            .await
            .map_err(|_| HostError::StatePoisoned)??;
        self.qualify_transport(owner)?;
        let mismatch = Arc::new(AtomicBool::new(false));
        let config = client_config(&identity, expected_server, mismatch.clone())?;
        let permit = self
            .peers
            .connections
            .clone()
            .try_acquire_owned()
            .map_err(|_| HostError::PeerBusy)?;
        let lease = self.peers.register(false)?;
        let result = bounded(
            &self.peers.cancel,
            &cancel,
            &PeerCancellation::new(),
            options.handshake_timeout,
            async {
                let socket = TcpStream::connect(address)
                    .await
                    .map_err(|_| HostError::PeerTransportUnavailable)?;
                tokio_rustls::TlsConnector::from(config)
                    .connect(
                        ServerName::try_from("exomind-peer.invalid")
                            .map_err(|_| HostError::InvalidRequest)?
                            .to_owned(),
                        socket,
                    )
                    .await
                    .map_err(|_| {
                        if mismatch.load(Ordering::Acquire) {
                            HostError::PeerPinMismatch
                        } else {
                            HostError::PeerTls
                        }
                    })
            },
        )
        .await?;
        self.qualify_transport(owner)?;
        channel(
            self.clone(),
            owner.clone(),
            result.into(),
            cancel,
            options,
            ConnectionOwnership {
                _permit: permit,
                _lease: lease,
            },
        )
        .map_err(|failure| failure.error)
    }
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
