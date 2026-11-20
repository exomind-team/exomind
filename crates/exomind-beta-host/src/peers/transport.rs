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
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
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
const ALPN_V1: &[u8] = b"exomind-peer-transport/1";
const ALPN_V2: &[u8] = b"exomind-peer-transport/2";
pub(super) const MAX_SERVICE_CANDIDATES: usize = 8;
pub(super) const MAX_FRAME: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PeerServiceVersion {
    V1,
    V2,
}

fn canonical_service_candidate(address: SocketAddr) -> Option<SocketAddr> {
    let ip = match address.ip() {
        IpAddr::V4(ip) => IpAddr::V4(ip),
        IpAddr::V6(ip) if ip.is_unicast_link_local() => return None,
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(ip)),
    };
    if address.port() == 0 || ip.is_unspecified() || ip.is_multicast() {
        return None;
    }
    Some(SocketAddr::new(ip, address.port()))
}

pub(super) fn validate_service_candidates(
    candidates: &[SocketAddr],
) -> Result<Vec<SocketAddr>, HostError> {
    if candidates.len() > MAX_SERVICE_CANDIDATES {
        return Err(HostError::InvalidRequest);
    }
    let mut output = Vec::with_capacity(candidates.len());
    for address in candidates {
        let canonical = canonical_service_candidate(*address).ok_or(HostError::InvalidRequest)?;
        if !output.contains(&canonical) {
            output.push(canonical);
        }
    }
    Ok(output)
}

pub(super) fn local_service_candidates(candidates: &[SocketAddr]) -> Vec<SocketAddr> {
    let mut output: Vec<_> = candidates
        .iter()
        .filter_map(|address| canonical_service_candidate(*address))
        .collect();
    if output.iter().any(|address| !address.ip().is_loopback()) {
        output.retain(|address| !address.ip().is_loopback());
    }
    output.sort_by_key(|address| {
        let loopback = address.ip().is_loopback();
        let family = if address.is_ipv4() { 0 } else { 1 };
        let private_rank = match address.ip() {
            IpAddr::V4(ip) if ip.is_private() => 0,
            IpAddr::V4(_) => 1,
            IpAddr::V6(ip) if ip.segments()[0] & 0xfe00 == 0xfc00 => 0,
            IpAddr::V6(_) => 2,
        };
        (loopback, private_rank, family, address.to_string())
    });
    output.dedup();
    if output.len() <= MAX_SERVICE_CANDIDATES {
        return output;
    }
    let mut bounded = Vec::with_capacity(MAX_SERVICE_CANDIDATES);
    for ipv4 in [true, false] {
        if let Some(address) = output.iter().find(|address| address.is_ipv4() == ipv4) {
            bounded.push(*address);
        }
    }
    for address in output {
        if bounded.len() == MAX_SERVICE_CANDIDATES {
            break;
        }
        if !bounded.contains(&address) {
            bounded.push(address);
        }
    }
    bounded
}

fn listener_service_candidates(listener: SocketAddr) -> Vec<SocketAddr> {
    if !listener.ip().is_unspecified() {
        return local_service_candidates(&[listener]);
    }
    let mut candidates: Vec<_> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| {
            let ip = interface.ip();
            if ip.is_unspecified()
                || ip.is_multicast()
                || (ip.is_ipv4() != listener.is_ipv4())
                || matches!(ip, IpAddr::V6(value) if value.is_unicast_link_local())
            {
                return None;
            }
            Some(SocketAddr::new(ip, listener.port()))
        })
        .collect();
    if candidates.is_empty() {
        candidates.push(SocketAddr::new(
            if listener.is_ipv4() {
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            } else {
                IpAddr::V6(Ipv6Addr::LOCALHOST)
            },
            listener.port(),
        ));
    }
    local_service_candidates(&candidates)
}
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
    pub(super) async fn cancelled(&self) {
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
    config.alpn_protocols = vec![ALPN_V2.to_vec(), ALPN_V1.to_vec()];
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
    config.alpn_protocols = vec![ALPN_V2.to_vec(), ALPN_V1.to_vec()];
    config.enable_early_data = false;
    config.resumption = rustls::client::Resumption::disabled();
    Ok(Arc::new(config))
}

// This value proves only TLS signature/key possession. It has no device UUID,
// profile, member epoch, grant or conversion into the local Session type.
struct VerifiedTransportPeer {
    pin: PeerPin,
    service_version: PeerServiceVersion,
}
fn verified(
    stream: &tokio_rustls::TlsStream<TcpStream>,
) -> Result<VerifiedTransportPeer, HostError> {
    let connection = stream.get_ref().1;
    if connection.protocol_version() != Some(ProtocolVersion::TLSv1_3) {
        return Err(HostError::PeerTls);
    }
    let service_version = if connection.alpn_protocol() == Some(ALPN_V2) {
        PeerServiceVersion::V2
    } else if connection.alpn_protocol() == Some(ALPN_V1) {
        PeerServiceVersion::V1
    } else {
        return Err(HostError::PeerTls);
    };
    let keys = connection.peer_certificates().ok_or(HostError::PeerTls)?;
    if keys.len() != 1 || !identity::valid_spki(keys[0].as_ref()) {
        return Err(HostError::PeerTls);
    }
    Ok(VerifiedTransportPeer {
        pin: PeerPin::of(keys[0].as_ref()),
        service_version,
    })
}
fn client_handshake_error(error: &std::io::Error, pin_mismatch: bool) -> HostError {
    // Authentication evidence wins even if the final socket operation also
    // failed. No TLS verifier, signature, ALPN or protocol check is relaxed.
    if pin_mismatch {
        return HostError::PeerPinMismatch;
    }
    if error.kind() == std::io::ErrorKind::InvalidData
        || error
            .get_ref()
            .is_some_and(|inner| inner.downcast_ref::<rustls::Error>().is_some())
    {
        return HostError::PeerTls;
    }
    match error.kind() {
        std::io::ErrorKind::TimedOut => HostError::PeerTimeout,
        std::io::ErrorKind::UnexpectedEof
        | std::io::ErrorKind::ConnectionReset
        | std::io::ErrorKind::ConnectionAborted
        | std::io::ErrorKind::ConnectionRefused
        | std::io::ErrorKind::NotConnected
        | std::io::ErrorKind::BrokenPipe => HostError::PeerTransportUnavailable,
        _ => HostError::PeerTls,
    }
}
#[cfg(test)]
fn handshake_diagnostic(error: &std::io::Error) -> (&'static str, bool) {
    let tls = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<rustls::Error>());
    let class = match tls {
        Some(rustls::Error::InvalidCertificate(_)) => "tls_certificate",
        Some(rustls::Error::PeerMisbehaved(_)) => "tls_protocol",
        Some(rustls::Error::AlertReceived(_)) => "tls_alert",
        Some(rustls::Error::DecryptError) => "tls_signature_or_decryption",
        Some(rustls::Error::General(_)) => "tls_general",
        Some(_) => "tls_other",
        None => "io_only",
    };
    (class, tls.is_some())
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
    id: uuid::Uuid,
    remote_address: SocketAddr,
    listener_address: Option<SocketAddr>,
    service_v2_join: AtomicBool,
    host: Arc<BetaHost>,
    owner: Session,
    peer: VerifiedTransportPeer,
    requests: mpsc::Sender<Request>,
    own: PeerCancellation,
    scope: PeerCancellation,
    done: PeerCancellation,
    expires_at: tokio::time::Instant,
    options: PeerTransportOptions,
}
impl PeerChannel {
    pub(super) fn binding_id(&self) -> uuid::Uuid {
        self.id
    }
    pub(super) fn service_version(&self) -> PeerServiceVersion {
        self.peer.service_version
    }
    pub(super) fn listener_candidates(&self) -> Vec<SocketAddr> {
        self.listener_address
            .map(listener_service_candidates)
            .unwrap_or_default()
    }
    pub(super) fn mark_service_v2_join(&self) {
        self.service_v2_join.store(true, Ordering::Release);
    }
    pub(super) fn service_v2_join(&self) -> bool {
        self.service_v2_join.load(Ordering::Acquire)
    }
    /// A key-possession proof bound to this Host and a still-live transport.
    /// Callers holding the Host gate can use this without acquiring it again.
    /// This grants no profile capability; membership must be rechecked in the
    /// same final Host transaction before any business operation.
    pub(super) fn binding_pin(&self, host: &BetaHost) -> Result<PeerPin, HostError> {
        if !std::ptr::eq(self.host.as_ref(), host) || self.owner.runtime_id != host.runtime_id {
            return Err(HostError::Unauthorized);
        }
        if !host.accepting.load(Ordering::Acquire) || host.peers.cancel.is_cancelled() {
            return Err(HostError::Stopped);
        }
        if self.own.is_cancelled()
            || self.scope.is_cancelled()
            || self.done.is_cancelled()
            || self.requests.is_closed()
        {
            return Err(HostError::PeerCancelled);
        }
        if tokio::time::Instant::now() >= self.expires_at {
            return Err(HostError::PeerTimeout);
        }
        Ok(self.peer.pin)
    }
    pub fn peer_fingerprint(&self) -> PeerPin {
        self.peer.pin
    }
    pub fn remote_address(&self) -> SocketAddr {
        self.remote_address
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
    /// Read-only completion witness. Captures only the private done watch,
    /// never this channel/Host and never exposes a sender capable of faking it.
    pub(super) fn closed_notification(&self) -> impl Future<Output = ()> + Send + 'static + use<> {
        let done = self.done.clone();
        async move { done.cancelled().await }
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
    listener_address: Option<SocketAddr>,
) -> Result<PeerChannel, ChannelAdmissionFailure> {
    let peer = match host
        .qualify_transport(&owner)
        .and_then(|()| verified(&stream))
    {
        Ok(peer) => peer,
        Err(error) => {
            #[cfg(test)]
            eprintln!(
                "peer_transport_diag runtime={} phase=post_tls tls13={} alpn_match={} peer_key_count={} rejected_tls={}",
                host.runtime_id,
                stream.get_ref().1.protocol_version() == Some(ProtocolVersion::TLSv1_3),
                stream
                    .get_ref()
                    .1
                    .alpn_protocol()
                    .is_some_and(|alpn| alpn == ALPN_V1 || alpn == ALPN_V2),
                stream
                    .get_ref()
                    .1
                    .peer_certificates()
                    .map(|keys| keys.len())
                    .unwrap_or(0),
                matches!(&error, HostError::PeerTls)
            );
            return Err(ChannelAdmissionFailure { error, ownership });
        }
    };
    let remote_address = match stream.get_ref().0.peer_addr() {
        Ok(address) => address,
        Err(_) => {
            return Err(ChannelAdmissionFailure {
                error: HostError::PeerTransportUnavailable,
                ownership,
            });
        }
    };
    let (put, mut requests) = mpsc::channel(1);
    let own = PeerCancellation::new();
    let done = PeerCancellation::new();
    let runtime = host.peers.clone();
    let global = runtime.cancel.clone();
    let kill = own.clone();
    let finished = done.clone();
    let held_host = host.clone();
    let expires_at = tokio::time::Instant::now() + options.channel_lifetime;
    let channel_scope = scope.clone();
    tokio::spawn(async move {
        let expires = expires_at;
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
        id: uuid::Uuid::new_v4(),
        remote_address,
        listener_address,
        service_v2_join: AtomicBool::new(false),
        host,
        owner,
        peer,
        requests: put,
        own,
        scope: channel_scope,
        done,
        expires_at,
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
        self.host.peers.clear_listener_address(self.address);
    }
}
impl BetaHost {
    pub(super) fn active_peer_listener_candidates(&self) -> Vec<SocketAddr> {
        self.peers
            .listener_address()
            .map(listener_service_candidates)
            .unwrap_or_default()
    }
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
                if address.is_ipv6() {
                    let socket = socket2::Socket::new(
                        socket2::Domain::IPV6,
                        socket2::Type::STREAM,
                        Some(socket2::Protocol::TCP),
                    )
                    .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .set_only_v6(false)
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .set_nonblocking(true)
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .bind(&address.into())
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .listen(16)
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    TcpListener::from_std(socket.into())
                        .map_err(|_| HostError::PeerTransportUnavailable)
                } else {
                    TcpListener::bind(address)
                        .await
                        .map_err(|_| HostError::PeerTransportUnavailable)
                }
            },
        )
        .await?;
        let address = socket
            .local_addr()
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        self.qualify_transport(owner)?;
        self.peers.set_listener_address(address)?;
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
                            Some(address),
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
    #[cfg(test)]
    pub(super) async fn listen_peer_transport_v1_for_test(
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
        let mut config = server_config(&identity)?;
        Arc::get_mut(&mut config)
            .ok_or(HostError::PeerTls)?
            .alpn_protocols = vec![ALPN_V1.to_vec()];
        let lease = self.peers.register(true)?;
        let cancel = PeerCancellation::new();
        let socket = bounded(
            &self.peers.cancel,
            &cancel,
            &PeerCancellation::new(),
            options.handshake_timeout,
            async {
                if address.is_ipv6() {
                    let socket = socket2::Socket::new(
                        socket2::Domain::IPV6,
                        socket2::Type::STREAM,
                        Some(socket2::Protocol::TCP),
                    )
                    .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .set_only_v6(false)
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .set_nonblocking(true)
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .bind(&address.into())
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    socket
                        .listen(16)
                        .map_err(|_| HostError::PeerTransportUnavailable)?;
                    TcpListener::from_std(socket.into())
                        .map_err(|_| HostError::PeerTransportUnavailable)
                } else {
                    TcpListener::bind(address)
                        .await
                        .map_err(|_| HostError::PeerTransportUnavailable)
                }
            },
        )
        .await?;
        let address = socket
            .local_addr()
            .map_err(|_| HostError::PeerTransportUnavailable)?;
        self.qualify_transport(owner)?;
        self.peers.set_listener_address(address)?;
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
                            Some(address),
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
                    .map_err(|error| {
                        #[cfg(test)]
                        {let(class,tls_inner)=handshake_diagnostic(&error);eprintln!("peer_transport_diag runtime={} phase=client_handshake io_kind={:?} class={} rustls_inner={} pin_mismatch={}",self.runtime_id,error.kind(),class,tls_inner,mismatch.load(Ordering::Acquire));}
                        client_handshake_error(&error,mismatch.load(Ordering::Acquire))
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
            None,
        )
        .map_err(|failure| failure.error)
    }
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
