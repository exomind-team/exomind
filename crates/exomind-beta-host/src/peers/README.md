# Device-key transport boundary

This module owns a persistent device key, bounded TLS 1.3 transport and a
Host-private profile membership/invitation ledger. A single invitation exchange
can run over a pinned channel; event replication and original transfer are not
implemented yet. The local admin HTTP router and its Bearer grants remain
loopback-only; private intents and source copies have no peer route.

`BetaHost::device_identity(owner)` lazily initializes one Ed25519 key bound to
the existing Core device UUID. Private PKCS8 bytes stay in a separate protected
identity database, outside ordinary Core exports. Public SPKI and its SHA-256
fingerprint are safe to share. An initialized ledger, external anchor and
independent host-auth pin distinguish interrupted first initialization from
missing or coherently replaced key material. Read/storage failures never
authorize a new key under the old UUID. SQLite values are bounded before any
identity query; key material is neither Debug nor Serialize state.

This prevents partial loss of the private directory/anchor from silently
rotating an already-bound key. It does not prevent cloning an entire machine or
rolling Core and auth back together to a pre-initialization snapshot. Explicit
identity recovery and restored-copy admission remain separate work.

`listen_peer_transport` and `connect_peer_transport` are trusted embedding
management APIs requiring the current local owner. They use explicit addresses,
timeouts and channel lifetimes; nothing starts a LAN listener automatically.
Dialing pins the expected server SPKI before returning a channel. Both sides
verify TLS 1.3 raw-public-key signatures and the expected ALPN. Early data and
session resumption are disabled.

A `VerifiedTransportPeer` proves possession of a key only. It contains no claimed
device UUID, profile, member epoch, grant or conversion to local `Session`.
Unknown valid client keys may complete transport authentication, but receive no
profile access. The membership layer binds key, device, profile, capabilities
and current revocation generation. Future fact and original handlers must check
that ledger under the final Host gate before each business operation.

The transport caps concurrent connections and bounds accept/error queues.
Handshake failures and post-handshake admission failures retain their resource
permits through bounded error reporting. Channel I/O is crate-private and
length-bounded. The separate pairing protocol accepts only claim, confirmation
and ready-observation acknowledgement messages, each bounded to 32 KiB. It
checks the invited issuer's pin before sending any one-use secret. Local member
readiness and observed remote readiness are distinct durable facts; lost replies
or the final acknowledgement can be retried with the same claim after restart.
Dropping a listener or channel
cancels its owned tasks. Host stop fences admission, cancels and drains all peer
leases before releasing the root lock; a drain timeout keeps that lock.
The existing Host stop API blocks, so async callers run it in `spawn_blocking`.

Tests use two real local TLS endpoints, including mismatched server pins,
forged client key claims, valid clients without ALPN, cancellation, timeouts,
connection budgets, retained channels and identity corruption/replacement.
Native pairing UI, listener lifecycle, Windows-to-Android TLS, LAN/EasyTier
recovery and business replication are separate acceptance gates. Explicit
re-pairing after one-sided revocation also remains unfinished; rejected old
evidence never causes implicit ID replacement or ledger cleanup. See the Host
README for management and storage boundaries.
