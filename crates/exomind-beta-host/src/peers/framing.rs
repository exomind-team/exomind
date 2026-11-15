//! Bounded logical messages over the authenticated physical TLS frame stream.
//! Byte integrity grants no member capability. The domain adapter must still
//! qualify its sealed profile scope inside the final Host transaction gate.
use super::transport::{MAX_FRAME, PeerChannel};
use crate::HostError;
use sha2::{Digest, Sha256};
use std::{future::Future, time::Duration};
use uuid::Uuid;

pub(super) const MAX_MESSAGE_BYTES: usize = exomind_core::MAX_ORIGIN_PAGE_BYTES;
const MAGIC: &[u8; 4] = b"EXL1";
const ID_END: usize = 4 + 16;
const TOTAL_END: usize = ID_END + 4;
const OFFSET_END: usize = TOTAL_END + 4;
const HEADER_BYTES: usize = OFFSET_END + 32;
const MAX_CHUNK_BYTES: usize = MAX_FRAME - HEADER_BYTES;
const MAX_FRAGMENTS: usize = MAX_MESSAGE_BYTES.div_ceil(MAX_CHUNK_BYTES);
const MAX_OPERATION_TIME: Duration = Duration::from_secs(30);

// There is no Clone, Arc constructor, raw-channel accessor, or split-half API.
// Mutable borrowing is the message-level exclusivity contract. A caller that
// needs blocking domain work moves this whole value into/through spawn_blocking.
pub(super) struct FramedPeerChannel {
    channel: Option<PeerChannel>,
}
impl FramedPeerChannel {
    pub(super) fn new(channel: PeerChannel) -> Self {
        Self {
            channel: Some(channel),
        }
    }

    /// The output cannot borrow the channel (HRTB); raw I/O futures and aliases
    /// cannot escape to race a logical message. This closure is synchronous.
    pub(super) fn with_channel<T>(
        &self,
        action: impl for<'a> FnOnce(&'a PeerChannel) -> T,
    ) -> Result<T, HostError> {
        self.channel
            .as_ref()
            .map(action)
            .ok_or(HostError::PeerTransportUnavailable)
    }

    pub(super) async fn send(
        &mut self,
        bytes: &[u8],
        timeout: Duration,
        cancel: impl Future<Output = ()>,
    ) -> Result<(), HostError> {
        let operation = Operation::take(&mut self.channel)?;
        let result = bounded(timeout, cancel, send_message(operation.channel()?, bytes)).await;
        if result.is_ok() {
            operation.complete();
        }
        result
    }

    pub(super) async fn receive(
        &mut self,
        timeout: Duration,
        cancel: impl Future<Output = ()>,
    ) -> Result<Vec<u8>, HostError> {
        let operation = Operation::take(&mut self.channel)?;
        let result = bounded(timeout, cancel, receive_message(operation.channel()?)).await;
        if result.is_ok() {
            operation.complete();
        }
        result
    }

    pub(super) async fn close(mut self) -> Result<(), HostError> {
        match self.channel.take() {
            Some(channel) => channel.close().await,
            None => Ok(()),
        }
    }
}

// Taking the unique channel before the first await makes dropped operation
// futures cancellation-safe. A partial send/read is never reusable: Drop closes
// this socket, and the slot stays empty. Only complete success restores it.
struct Operation<'a> {
    slot: &'a mut Option<PeerChannel>,
    owned: Option<PeerChannel>,
}
impl<'a> Operation<'a> {
    fn take(slot: &'a mut Option<PeerChannel>) -> Result<Self, HostError> {
        let owned = slot.take().ok_or(HostError::PeerTransportUnavailable)?;
        Ok(Self {
            slot,
            owned: Some(owned),
        })
    }
    fn channel(&self) -> Result<&PeerChannel, HostError> {
        self.owned
            .as_ref()
            .ok_or(HostError::PeerTransportUnavailable)
    }
    fn complete(mut self) {
        *self.slot = self.owned.take();
    }
}

async fn bounded<T>(
    timeout: Duration,
    cancel: impl Future<Output = ()>,
    action: impl Future<Output = Result<T, HostError>>,
) -> Result<T, HostError> {
    if timeout.is_zero() || timeout > MAX_OPERATION_TIME {
        return Err(HostError::InvalidRequest);
    }
    tokio::select! {
        biased;
        _ = cancel => Err(HostError::PeerCancelled),
        result = tokio::time::timeout(timeout, action) => result.map_err(|_| HostError::PeerTimeout)?,
    }
}

struct Header {
    id: Uuid,
    total: usize,
    offset: usize,
    sha256: [u8; 32],
}
fn fragment(id: Uuid, total: usize, offset: usize, sha256: &[u8; 32], bytes: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(HEADER_BYTES + bytes.len());
    frame.extend_from_slice(MAGIC);
    frame.extend_from_slice(id.as_bytes());
    frame.extend_from_slice(&(total as u32).to_be_bytes());
    frame.extend_from_slice(&(offset as u32).to_be_bytes());
    frame.extend_from_slice(sha256);
    frame.extend_from_slice(bytes);
    frame
}
fn header(frame: &[u8]) -> Result<Header, HostError> {
    if frame.len() < HEADER_BYTES || frame.len() > MAX_FRAME || &frame[..4] != MAGIC {
        return Err(HostError::InvalidRequest);
    }
    let id = Uuid::from_slice(&frame[4..ID_END]).map_err(|_| HostError::InvalidRequest)?;
    let total = u32::from_be_bytes(
        frame[ID_END..TOTAL_END]
            .try_into()
            .map_err(|_| HostError::InvalidRequest)?,
    ) as usize;
    let offset = u32::from_be_bytes(
        frame[TOTAL_END..OFFSET_END]
            .try_into()
            .map_err(|_| HostError::InvalidRequest)?,
    ) as usize;
    if total > MAX_MESSAGE_BYTES {
        return Err(HostError::PayloadTooLarge);
    }
    if id.is_nil() || offset > total {
        return Err(HostError::InvalidRequest);
    }
    let sha256 = frame[OFFSET_END..HEADER_BYTES]
        .try_into()
        .map_err(|_| HostError::InvalidRequest)?;
    Ok(Header {
        id,
        total,
        offset,
        sha256,
    })
}

async fn send_message(channel: &PeerChannel, bytes: &[u8]) -> Result<(), HostError> {
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(HostError::PayloadTooLarge);
    }
    let id = Uuid::new_v4();
    let sha256: [u8; 32] = Sha256::digest(bytes).into();
    if bytes.is_empty() {
        return channel.send_frame(fragment(id, 0, 0, &sha256, &[])).await;
    }
    for (index, chunk) in bytes.chunks(MAX_CHUNK_BYTES).enumerate() {
        channel
            .send_frame(fragment(
                id,
                bytes.len(),
                index * MAX_CHUNK_BYTES,
                &sha256,
                chunk,
            ))
            .await?;
    }
    Ok(())
}
async fn receive_message(channel: &PeerChannel) -> Result<Vec<u8>, HostError> {
    let mut frame = channel.read_frame().await?;
    let first = header(&frame)?;
    if first.offset != 0 {
        return Err(HostError::InvalidRequest);
    }
    let mut assembled = Vec::new();
    // The untrusted total was checked before reserving. At most one logical
    // buffer plus one <=256KiB physical frame is retained per operation.
    assembled
        .try_reserve_exact(first.total)
        .map_err(|_| HostError::PeerTransportUnavailable)?;
    for _ in 0..MAX_FRAGMENTS {
        let current = header(&frame)?;
        if current.id != first.id
            || current.total != first.total
            || current.sha256 != first.sha256
            || current.offset != assembled.len()
        {
            return Err(HostError::InvalidRequest);
        }
        let payload = &frame[HEADER_BYTES..];
        let expected = MAX_CHUNK_BYTES.min(first.total - assembled.len());
        // All non-tail chunks are full; duplicates (including identical ones)
        // and zero-progress fragments are rejected instead of extending limits.
        if payload.len() != expected {
            return Err(HostError::InvalidRequest);
        }
        assembled.extend_from_slice(payload);
        if assembled.len() == first.total {
            let actual: [u8; 32] = Sha256::digest(&assembled).into();
            if actual != first.sha256 {
                return Err(HostError::InvalidRequest);
            }
            return Ok(assembled);
        }
        frame = channel.read_frame().await?;
    }
    Err(HostError::InvalidRequest)
}

#[cfg(test)]
#[path = "framing_tests.rs"]
mod tests;
