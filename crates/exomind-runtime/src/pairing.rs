use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// How long a pairing session stays valid (5 minutes).
const SESSION_TTL: Duration = Duration::from_secs(300);

/// A single in-progress pairing session.
#[derive(Debug, Clone)]
pub struct PairingSession {
    pub session_id: String,
    pub pin: String,
    pub initiator_host_id: String,
    pub created_at: Instant,
}

/// Error returned when pairing verification fails.
#[derive(Debug, thiserror::Error)]
pub enum PairingError {
    #[error("session not found or expired")]
    SessionNotFound,
    #[error("incorrect PIN")]
    IncorrectPin,
}

/// Result of a successful pairing response.
#[derive(Debug, Clone)]
pub struct PairingResult {
    pub peer_token: String,
    pub initiator_host_id: String,
}

/// Thread-safe manager for PIN pairing sessions.
pub struct PairingManager {
    sessions: RwLock<HashMap<String, PairingSession>>,
}

impl PairingManager {
    /// Create an empty pairing manager.
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Initiate a new pairing session.
    ///
    /// Generates a random 6-digit PIN and a UUID session ID.
    /// Expired sessions are cleaned up before creating the new one.
    pub fn initiate(&self, initiator_host_id: String) -> PairingSession {
        self.cleanup_expired();

        let session_id = Uuid::new_v4().to_string();
        let pin = generate_pin();
        let session = PairingSession {
            session_id: session_id.clone(),
            pin: pin.clone(),
            initiator_host_id,
            created_at: Instant::now(),
        };

        {
            let mut sessions = match self.sessions.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            sessions.insert(session_id, session.clone());
        }

        session
    }

    /// Respond to a pairing session by providing the PIN.
    ///
    /// On correct PIN: generates a peer_token, removes the session, and returns Ok.
    /// On incorrect PIN: immediately destroys the session (anti-brute-force) and returns Err.
    /// On expired/missing session: returns Err.
    pub fn respond(
        &self,
        session_id: &str,
        pin: &str,
        responder_host_id: &str,
    ) -> Result<PairingResult, PairingError> {
        self.cleanup_expired();

        let session = {
            let mut sessions = match self.sessions.write() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };

            let session = sessions.remove(session_id).ok_or(PairingError::SessionNotFound)?;

            // Check expiry even if found (belt-and-suspenders).
            if session.created_at.elapsed() > SESSION_TTL {
                return Err(PairingError::SessionNotFound);
            }

            session
        };

        // Session is already removed from the map — one-shot usage.
        if session.pin != pin {
            return Err(PairingError::IncorrectPin);
        }

        let peer_token = generate_peer_token(
            &session.session_id,
            &session.initiator_host_id,
            responder_host_id,
        );

        Ok(PairingResult {
            peer_token,
            initiator_host_id: session.initiator_host_id,
        })
    }

    /// Respond to a pairing session by looking up via initiator host_id.
    ///
    /// Used when the responder does not know the session_id (e.g. discovered via mDNS).
    /// If the initiator has exactly one active session, it will be matched.
    pub fn respond_by_initiator(
        &self,
        initiator_host_id: &str,
        pin: &str,
        responder_host_id: &str,
    ) -> Result<PairingResult, PairingError> {
        self.cleanup_expired();

        let session_id = {
            let sessions = match self.sessions.read() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            sessions
                .values()
                .find(|s| s.initiator_host_id == initiator_host_id && s.created_at.elapsed() <= SESSION_TTL)
                .map(|s| s.session_id.clone())
                .ok_or(PairingError::SessionNotFound)?
        };

        self.respond(&session_id, pin, responder_host_id)
    }

    /// Remove all expired sessions.
    fn cleanup_expired(&self) {
        let mut sessions = match self.sessions.write() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        sessions.retain(|_, session| session.created_at.elapsed() <= SESSION_TTL);
    }

    /// Get the number of active sessions (for testing).
    #[cfg(test)]
    pub fn active_session_count(&self) -> usize {
        let sessions = match self.sessions.read() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        sessions.len()
    }
}

/// Generate a 6-digit PIN by sampling each digit independently.
fn generate_pin() -> String {
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| rng.gen_range(0..10).to_string())
        .collect()
}

/// Generate a peer_token as SHA-256 hex digest of session material + random UUID.
fn generate_peer_token(session_id: &str, initiator: &str, responder: &str) -> String {
    let salt = Uuid::new_v4().to_string();
    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    hasher.update(initiator.as_bytes());
    hasher.update(responder.as_bytes());
    hasher.update(salt.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_is_six_digits() {
        let pin = generate_pin();
        assert_eq!(pin.len(), 6);
        assert!(pin.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn initiate_creates_session() {
        let manager = PairingManager::new();
        let session = manager.initiate("host-a".to_string());
        assert!(!session.session_id.is_empty());
        assert_eq!(session.pin.len(), 6);
        assert_eq!(session.initiator_host_id, "host-a");
        assert_eq!(manager.active_session_count(), 1);
    }

    #[test]
    fn respond_correct_pin_succeeds() {
        let manager = PairingManager::new();
        let session = manager.initiate("host-a".to_string());

        let result = manager
            .respond(&session.session_id, &session.pin, "host-b")
            .expect("correct PIN should succeed");

        assert!(!result.peer_token.is_empty());
        assert_eq!(result.initiator_host_id, "host-a");
        // Session consumed.
        assert_eq!(manager.active_session_count(), 0);
    }

    #[test]
    fn respond_wrong_pin_fails_and_destroys_session() {
        let manager = PairingManager::new();
        let session = manager.initiate("host-a".to_string());

        let err = manager
            .respond(&session.session_id, "000000", "host-b")
            .unwrap_err();
        assert!(matches!(err, PairingError::IncorrectPin));
        // Session destroyed even though PIN was wrong.
        assert_eq!(manager.active_session_count(), 0);
    }

    #[test]
    fn respond_missing_session_fails() {
        let manager = PairingManager::new();
        let err = manager
            .respond("nonexistent", "123456", "host-b")
            .unwrap_err();
        assert!(matches!(err, PairingError::SessionNotFound));
    }

    #[test]
    fn session_cannot_be_used_twice() {
        let manager = PairingManager::new();
        let session = manager.initiate("host-a".to_string());
        let pin = session.pin.clone();
        let sid = session.session_id.clone();

        // First respond succeeds.
        manager.respond(&sid, &pin, "host-b").unwrap();

        // Second respond fails (session already consumed).
        let err = manager.respond(&sid, &pin, "host-c").unwrap_err();
        assert!(matches!(err, PairingError::SessionNotFound));
    }

    #[test]
    fn peer_token_is_sha256_hex() {
        let token = generate_peer_token("sess-1", "host-a", "host-b");
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
