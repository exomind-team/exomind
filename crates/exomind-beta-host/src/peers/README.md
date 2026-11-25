# Beta peer transport and replication

This module connects authorized replicas of the same profile. Start by identifying which result you need to explain. The address of a recently seen device, permission to read a profile, confirmation of a fact, and availability of an original file have different owners. [Beta architecture](../../../../docs/architecture/README.md)

| Question | Where to follow the operation |
|---|---|
| Which device answered on this route? | [Transport](transport.rs) verifies the peer key over TLS. [Identity](identity.rs) binds the device UUID to its persisted key. Discovery and scope-limited probes provide candidate addresses. |
| Can the peer access this profile? | [Membership store](membership_store.rs) and [authorization](authorization.rs) check profile, pinned identity, permissions, membership generations and active channel at the point of use. Pairing can establish a member; Agent HTTP grants have a separate issuer and purpose. |
| Where are settings saved, and which route does a worker dial? | [Connection store](connection_store.rs) persists environment and connection records, local enable state and endpoint order. The [network worker](network.rs) selects from profile/device routes via [network management](network_management.rs) and qualified candidates. [B1a implementation scope](../../../../docs/plans/2026-11-22-beta26-b1a-connection-store.md) |
| Did a fact reach another replica? | [Multi-origin sync](multi_sync.rs), [source history](source_history.rs), [proofs](origin_proof.rs) and [ACK store](sync_store.rs) retain origin/epoch, prefix and receiving-device evidence. Core owns transactional admission. [Replication contract](../../../../docs/development/beta-multiorigin-sync.md) |
| Is the time block usable, and are its attached bytes available? | The sync result carries fact coverage, time-block projection completeness and original availability separately. [Original transfer](original_transfer.rs) and [original jobs](original_network.rs) fetch and verify bytes with current permissions. [Return routes and the originals queue](../../../../docs/development/beta-peer-return-routes.md) |

Device identity is durable, runtime and TLS channel belong to one running session. If key material or its stored identity binding cannot be verified, preserve the data and report recovery. A signed invitation authorizes the specified profile only through its acceptance protocol. A changed address remains subject to the original identity check. [Pairing](pairing.rs) · [Discovery versus membership](../../../../docs/development/beta-nearby-discovery.md)

For a change to reconnect or fallback, use the [network regressions](network_tests.rs). Test the actual dial, stop, cancellation and delayed results. For an end-to-end claim, verify a record and its original on the receiving device with the same candidate. [Delivery evidence](../../../../docs/AI-CONTEXT.md)
