# Beta capture entry

This is an incremental B1 capture/timeblock client, not the completed Beta or B4 UI migration.
`beta.html` loads `beta-main.tsx` directly. It does not load the legacy `main.tsx`,
runtime bootstrap, profile store, sync store, or eventlog service.

## Current task checklist

- [x] Injectable Native / HTTP client with checked DTOs and scoped human grants.
- [x] Anonymous protocol check before credentials; pin device identity, allow runtime restart.
- [x] Device/profile draft persistence and immutable retry command snapshots.
- [x] Check original receipt before retry; validate binding before clearing only the submitted draft revision.
- [x] Real profile creation/selection, confirmed history, snapshot pagination, literal text search.
- [x] Existing PageShell, Button, Input, Textarea, EventTimestamp and warm stone tokens.
- [x] Public behavior tests for retries, stale responses, profile isolation, pagination and failures.
- [x] Shared Alpha NowInputRowView, FocusTimerView, feedback dialog and live overlay presentation.
- [x] Typed Core timeblocks, mixed history and main-owned Native overlay relay.
- [x] Native private intent journal and bounded private source copies; Web keeps separate IDB storage.
- [x] Parent checkpoints: actual Native text/timeblock UI, restart and IME/layout acceptance; see the execution ledger for exact source/package scope.
- [x] Exact durable-source APK controller acceptance: automatic resume and isolated B-only missing-source recovery.
- [ ] Actual complete picker UI, current keyboard-layout regression and desktop overlay/window acceptance.
- [ ] Full Alpha page/layout inheritance, complete scroll anchoring and remaining B2–B5 stories.

## Connection

Native invokes `beta_*` commands; trusted Rust sessions hold credentials.
Web users enter the Host origin and owner token. This token is stored only in
sessionStorage, never a URL; the client obtains separate profile human grants.
The Host must allow this UI's exact Origin when using different origins. Redirects
are rejected. No legacy HTTP routes or storage fallback are used.

Every operation first checks the service device identity. A changed device is a
blocking error requiring reconnect; the old device's drafts are kept. A changed
runtime on the same device clears cached grants and permits receipt lookup.

## Draft and history boundaries

Journal key `exomind:beta:drafts:<device_id>` holds a profile-indexed map and
pending commands. Native uses its private FULL SQLite journal; Web uses a strict
IDB transaction journal. An existing canonical journal wins over its predecessors.
Missing reliable storage never silently imports an older localStorage snapshot;
that recovery requires an explicit, device/profile-bound user action.
Web Locks grant one editing window per device; unsupported
browsers fail closed. An occupied lock exposes an explicit retry button after
the other window releases it; retry only reacquires the same device lock and
does not submit drafts or recreate profile grants. Effect replay waits for this
workspace's previous lock request to settle completely before requesting again;
this does not queue behind locks held by other windows. Tests use the same lock
branch as production with asynchronous grant/release fixtures. No timer or reconnect automatically submits saved drafts.
An unavailable or corrupt draft cache blocks submission without overwriting it.
Known committed receipts may still show a local cache failure without changing
the durable save into an uncertain result. User-authored text uses escaped React
text. History renders only backend facts, never pending submissions as saved events.

Pagination retains `highwater` via `through`; explicit refresh/search starts a new
snapshot. Old requests cannot replace a newly selected profile or search. Search
uses the Core's case-sensitive literal substring semantics. Date display reuses
the same current-date-aware formatter and timestamp toggle as the existing app.

Generic originals use the shared Alpha `NowInputRowView` attachment control and
the existing quote-banner tokens. The hidden multiple file input accepts unknown
extensions/MIME and empty files. This is functional composition; full Alpha page
layout inheritance remains a B4 acceptance gate.

The draft cache first journals a clearly `preparing` selection intent with stable
IDs and a device/profile/source key. Native then copies bytes to the owner-only
[private source cache](../../crates/exomind-beta-host/NATIVE-SOURCES.md), verifies
the complete hash and exposes a 256 KiB range reader. Web copies a Blob through
an IDB transaction. Hash reads are incremental at 256 KiB. Missing bytes, quota or cache
failures retain a failed selection and block submission instead of dropping it
and sending pure text. Browser File objects themselves are never the persisted
recovery mechanism. Reopening may resume staging, but never submits a capture.
Reselection of a known source is bound to its original hash.

Submit freezes text, ordered full original descriptors, command/event/time and
profile before any capture RPC. Uploads are serialized; capture waits for every
item to be verified. Later text or attachment edits have a different revision and
are not cleared by the old receipt. A lost outcome first queries its exact
receipt. Verified staging alone is never shown as a saved record. A temporary
duplicate may be released after the Core verifies it; removing a selection does
not delete Core bytes or a source still needed by a frozen command. Interrupted,
removed, unverified copies are retained for later explicit lifecycle cleanup.

Confirmed originals have a basic range-read download that verifies the complete
hash before constructing a Blob. This browser path accepts at most 64 MiB per
download, with additional Blob/copy overhead; that limit does not cap uploads.
Multi-GB native/disk streaming export and throughput are not claimed by this
entry. Unknown originals are downloaded, never automatically executed or parsed.

Count-up/down, pause/resume/rotate/end/feedback use Core facts; display clocks
never decide business completion. The overlay is a separate controlled view:
only Main owns clients, controllers and journals, while Native tickets bind
requests to runtime/device/profile/owner generation and state revisions.
Actual desktop window behavior and complete Alpha visual parity still need acceptance.

Voice, editing/deletion, peer sync, model workflows, legacy import and full old UI
composition are not implemented by this entry. Draft lifecycle/retention remains
explicit: unresolved commands retain their full snapshots; confirmed commands drop
their text and keep at most eight receipt/revision metadata entries per device.
Older cache versions migrate successful full snapshots to this bounded metadata
when loaded and remove their text on the next cache write.

Focused checks: `node node_modules/vitest/vitest.mjs run tests/unit/beta --maxWorkers=1`,
then the parent-owned `build:web`. Run heavy verification serially on Windows.
