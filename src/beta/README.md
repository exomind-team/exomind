# Beta text entry

This is an incremental B1 text client, not the completed Beta or B4 UI migration.
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
- [x] Parent verification: 22 focused tests, TypeScript/Web build, 17 actual Edge/Host checks.
- [ ] Native host integration and actual desktop/device acceptance by parent.
- [ ] Full existing UI reuse/extracted NowInputRow presentation (B4, subsequent work).

## Connection

Native invokes the six `beta_*` commands; trusted Rust sessions hold credentials.
Web users enter the Host origin and owner token. This token is stored only in
sessionStorage, never a URL; the client obtains separate profile human grants.
The Host must allow this UI's exact Origin when using different origins. Redirects
are rejected. No legacy HTTP routes or storage fallback are used.

Every operation first checks the service device identity. A changed device is a
blocking error requiring reconnect; the old device's drafts are kept. A changed
runtime on the same device clears cached grants and permits receipt lookup.

## Draft and history boundaries

LocalStorage key `exomind:beta:drafts:<device_id>` holds a profile-indexed map and
pending commands. Web Locks grant one editing window per device; unsupported
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

Attachments, voice, editing/deletion, sync, migration, focus timers and full old UI
composition are not implemented by this entry. Draft lifecycle/retention remains
explicit: unresolved commands retain their full snapshots; confirmed commands drop
their text and keep at most eight receipt/revision metadata entries per device.
Older cache versions migrate successful full snapshots to this bounded metadata
when loaded and remove their text on the next cache write.

Focused checks: `node node_modules/vitest/vitest.mjs run tests/unit/beta --maxWorkers=1`,
then the parent-owned `build:web`. Run heavy verification serially on Windows.
