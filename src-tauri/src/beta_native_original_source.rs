//! Platform-free Native original reading, shared by export and system open.
//! Keeping the exact reader in a small module lets the Host CI lane test its
//! generation checks without linking a desktop window or duplicating the code.
use super::{Failure, failure};
use exomind_beta_host::{BetaHost, HostOriginalReadPermit, Session};
use exomind_core::{OriginalId, OriginalRef, ProfileId};
use std::sync::Arc;

pub(super) struct Source {
    host: Arc<BetaHost>,
    session: Session,
    pub(super) original: OriginalRef,
    permit: HostOriginalReadPermit,
}
impl Source {
    pub(super) fn begin(
        host: Arc<BetaHost>,
        session: Session,
        profile: ProfileId,
        original_id: OriginalId,
    ) -> Result<Self, Failure> {
        // The session is Native.human(profile), never the global owner session.
        let permit = host
            .begin_original_read(&session, profile, original_id)
            .map_err(Failure::from)?;
        let first = host
            .read_original_range_with_permit(&session, &permit, 0, 1)
            .map_err(Failure::from)?;
        if first.offset != 0
            || first.original.original_id != original_id
            || first.bytes.len() != first.original.byte_length.min(1) as usize
        {
            return Err(failure("original_integrity", "原件描述已变化，未完成导出"));
        }
        Ok(Self {
            host,
            session,
            original: first.original,
            permit,
        })
    }

    pub(super) fn read(&self, offset: u64, length: usize) -> Result<Vec<u8>, Failure> {
        let chunk = self
            .host
            .read_original_range_with_permit(&self.session, &self.permit, offset, length)
            .map_err(Failure::from)?;
        if chunk.offset != offset || chunk.original != self.original {
            return Err(failure("original_integrity", "原件描述已变化，未完成导出"));
        }
        Ok(chunk.bytes)
    }

    pub(super) fn finish(&self) -> Result<(), Failure> {
        self.host
            .finish_original_read(&self.session, &self.permit)
            .map_err(Failure::from)
    }
}
