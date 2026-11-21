# Beta26 Environment and Multi-Connection Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Use
> `superpowers:test-driven-development` for every production change. Do not
> create a worktree unless the user later changes the current instruction.

**Goal:** Replace the profile-coupled peer-route presentation with stable
ExoMind environments, independently controllable multi-path connections,
profile-scoped memberships, actionable discovery/invitation flows, and bounded
sync diagnostics without letting any waiting or error state become a dead end.

**Architecture:** The existing Core remains the only fact and membership
authority. Host gains environment and connection records above profile
membership; Native and UI expose those records through fixed commands. ACP is
outside this plan. The selected Beta26 path is incremental. The full T3-like
connection supervisor remains a documented long-term option and is not
implemented here.

**Tech Stack:** Rust, Tokio, rusqlite, Tauri 2, React 18, TypeScript, Zustand,
Vitest, Playwright/Edge, ADB, existing signed peer transport and diagnostics.

---

## Execution Constraints

- Use the current `dev-0.6` worktree. The user explicitly prohibited new
  worktrees for this task.
- Keep candidate artifacts outside the repository. Use
  `G:/exomind-cargo-target` for Rust target output because the H: drive is below
  the repository's 2 GiB build-space safety threshold.
- Do not read or copy user profile content, model keys, invitation secrets, or
  bearer credentials into evidence.
- Do not automatically probe every historical connection. Passive discovery may
  continue under the discovery setting; explicit connection tests occur only
  after a user action. Actual sync may dial when there are facts or work to move.
- Every commit is pushed immediately. Verify the remote SHA and clean worktree.
- Keep Beta25 immutable. These changes belong to a Beta26 successor.

## Task 1: Establish the actionable-state UX contract

**Files:**

- Create: `src/beta/BetaActionableState.tsx`
- Create: `src/beta/redacted-diagnostic.ts`
- Create: `tests/unit/beta/actionable-state.test.tsx`
- Create: `tests/unit/beta/redacted-diagnostic.test.ts`
- Modify: `docs/architecture/principles.md`
- Modify: `docs/development/ui-spec.md`
- Modify: `docs/development/beta-ui-user-requirements.md`

**Step 1: Write the failing component tests**

```tsx
it('never renders a blocking error without an executable exit or diagnostic', () => {
  render(<BetaActionableState
    state="error"
    title="连接失败"
    detail="所有地址均不可达"
    actions={[{ id: 'retry', label: '重新测试' }]}
    diagnostic={diagnosticFixture}
  />);

  expect(screen.getByRole('button', { name: '重新测试' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '复制诊断' })).toBeEnabled();
});

it('keeps a redacted state visible while hiding protected values', () => {
  render(<BetaActionableState
    state="private"
    title="档案离线"
    detail="状态可见，正文与标识已隐藏"
    actions={[]}
    diagnostic={diagnosticFixture}
  />);

  expect(screen.getByText('档案离线')).toBeVisible();
  expect(screen.queryByText('private-note-body')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '复制诊断' })).toBeEnabled();
});
```

**Step 2: Run the tests and verify RED**

```powershell
bunx vitest run tests/unit/beta/actionable-state.test.tsx --maxWorkers=1
```

Expected: FAIL because `BetaActionableState` does not exist.

**Step 3: Add the diagnostic redaction test**

```ts
it('drops content and secrets while retaining trace identifiers', () => {
  const value = buildRedactedDiagnostic({
    operation: 'join_invitation',
    code: 'peer_unreachable',
    occurredAtMs: 1000,
    deviceId: '11111111-1111-4111-8111-111111111111',
    profileId: '22222222-2222-4222-8222-222222222222',
    candidate: '10.0.0.2:43344',
    invitationText: '{\"secret\":\"do-not-copy\"}',
    message: 'all candidates failed',
  });
  expect(value).toContain('peer_unreachable');
  expect(value).toContain('10.0.0.2:43344');
  expect(value).not.toContain('do-not-copy');
});
```

Run:

```powershell
bunx vitest run tests/unit/beta/redacted-diagnostic.test.ts --maxWorkers=1
```

Expected: FAIL because the builder is absent.

**Step 4: Implement the minimum shared contract**

`BetaActionableState` must accept:

```ts
type Action = { id: string; label: string; disabled?: boolean };
type Props = {
  state: 'pending' | 'success' | 'warning' | 'error' | 'unknown' | 'private';
  title: string;
  detail: string;
  lastConfirmedAtMs?: number;
  actions: Action[];
  diagnostic: RedactedDiagnostic;
  onAction: (id: string) => void;
  onCopyDiagnostic: () => Promise<'copied' | 'failed'>;
};
```

The component must:

- render the state, title, detail, last-confirm time, and every action;
- render a deterministic `复制诊断` action for pending/error/unknown states;
- announce copy success/failure without hiding the retry path;
- preserve keyboard and touch operation;
- show no profile body, token, invitation secret or original bytes.

Add these invariants to `docs/architecture/principles.md`:

| invariant | affordance | implementation owner |
|---|---|---|
| all consequential state has a projection | 发生着的事都能看见；私密内容可遮住，状态不会被抹掉 | state owner + UI |
| no suspended wait | 等待有回应，出错有下一步 | operation owner + shared state surface |

Add the default/detail/diagnostic projection and review veto to the UI spec.

**Step 5: Run the tests and verify GREEN**

```powershell
bunx vitest run tests/unit/beta/actionable-state.test.tsx tests/unit/beta/redacted-diagnostic.test.ts --maxWorkers=1
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/beta/BetaActionableState.tsx src/beta/redacted-diagnostic.ts tests/unit/beta/actionable-state.test.tsx tests/unit/beta/redacted-diagnostic.test.ts docs/architecture/principles.md docs/development/ui-spec.md docs/development/beta-ui-user-requirements.md
git commit -m "feat(beta): add actionable state contract"
git push origin dev-0.6
```

## Task 2: Make invitation candidates safe and diagnosable

**Files:**

- Modify: `crates/exomind-beta-host/src/peers/network.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_store.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_tests.rs`
- Modify: `src-tauri/src/beta_native_peers.rs`
- Modify: `src/beta/peers-client.ts`
- Modify: `tests/unit/beta/peers-client.test.ts`

**Step 1: Write failing Rust tests**

Add tests beside the existing network tests:

```rust
#[test]
fn invitation_candidates_never_include_loopback_or_link_local() {
    let candidates = shareable_endpoints_for_test(
        "127.0.0.1:43344".parse().unwrap(),
        vec![
            "127.0.0.1".parse().unwrap(),
            "169.254.2.3".parse().unwrap(),
            "10.144.144.6".parse().unwrap(),
        ],
    );
    assert_eq!(candidates, vec!["10.144.144.6:43344".parse().unwrap()]);
}

#[test]
fn legacy_loopback_invitation_is_reported_as_skipped_not_identity_mismatch() {
    let report = classify_join_candidates(vec![
        "127.0.0.1:43344".parse().unwrap(),
        "10.144.144.6:43344".parse().unwrap(),
    ]);
    assert_eq!(report.skipped_loopback, 1);
    assert_eq!(report.attempted, 1);
}
```

Run:

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind-beta-host --lib peers::network::tests -- --test-threads=1
```

Expected: FAIL because neither helper exists.

**Step 2: Implement candidate separation**

Split local diagnostics from shareable invitation candidates:

- `local_addresses()` may retain loopback for same-host tests;
- `shareable_addresses()` excludes loopback, unspecified, multicast, link-local,
  invalid ports and duplicates;
- invitation creation uses `shareable_addresses()` only;
- invitation joining filters loopback from both signed and manually supplied
  candidates when the receiver is a different process/device;
- retain loopback only behind an explicit test-only helper.

Do not change TLS pinning or downgrade identity checks.

**Step 3: Extend the invite inspection response**

Add a bounded, serializable candidate report:

```rust
pub struct InvitationEndpointReport {
    pub endpoint: String,
    pub disposition: &'static str, // attempted/skipped/reachable/identity_mismatch/unreachable/protocol_mismatch
    pub elapsed_ms: u64,
    pub error_code: Option<&'static str>,
}
```

The final join error must include the per-endpoint outcome through a diagnostic
handle or typed command failure. It must never report one self-loopback's pin
mismatch when no remote endpoint answered.

**Step 4: Write the TypeScript validation test**

```ts
it('accepts bounded invitation endpoint reports and preserves per-route failure', async () => {
  const client = nativeBetaPeersClient(async () => ({
    profile_id: P,
    profile_name: 'P',
    issuer_device_id: D,
    fingerprint_sha256: 'a'.repeat(64),
    expires_at_ms: 10,
    compatible: true,
    endpoints: [
      { endpoint: '127.0.0.1:43344', disposition: 'skipped', elapsed_ms: 0, error_code: 'loopback_not_shareable' },
      { endpoint: '10.0.0.2:43344', disposition: 'unreachable', elapsed_ms: 2000, error_code: 'timeout' },
    ],
  }));
  await expect(client.inspectInvitation('invite')).resolves.toMatchObject({
    endpoints: expect.any(Array),
  });
});
```

Run:

```powershell
bunx vitest run tests/unit/beta/peers-client.test.ts --maxWorkers=1
```

Expected: FAIL until the schema validator is extended.

**Step 5: Implement and run tests**

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind-beta-host --lib peers::network::tests -- --test-threads=1
bunx vitest run tests/unit/beta/peers-client.test.ts --maxWorkers=1
```

Expected: PASS with non-zero test counts.

**Step 6: Commit**

```powershell
git add crates/exomind-beta-host/src/peers/network.rs crates/exomind-beta-host/src/peers/network_store.rs crates/exomind-beta-host/src/peers/network_tests.rs src-tauri/src/beta_native_peers.rs src/beta/peers-client.ts tests/unit/beta/peers-client.test.ts
git commit -m "fix(beta): make invitation candidates shareable"
git push origin dev-0.6
```

## Task 3: Add bounded user-triggered network scanning

**Files:**

- Modify: `crates/exomind-beta-host/src/peers/network.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_tests.rs`
- Modify: `src-tauri/src/beta_native_peers.rs`
- Modify: `src/beta/peers-client.ts`
- Modify: `src/beta/NearbyDeviceCandidates.tsx`
- Modify: `src/beta/BetaPeersPage.tsx`
- Modify: `tests/unit/beta/peers-page.test.tsx`

**Step 1: Write failing backend tests**

Cover:

- a manual scan includes selected physical and EasyTier scopes;
- it excludes loopback/WSL by default;
- duplicate, broadcast, multicast, invalid and self addresses are skipped;
- a `/21` or larger scope is capped by the configured maximum host count;
- cancellation prevents late candidates from appearing;
- two overlapping scans preserve the newest generation only;
- scan with no profile and no existing membership is permitted;
- scan never creates a route, membership or grant.

Use real UDP loopback test sockets, as existing discovery tests do.

**Step 2: Implement a one-shot scan service**

Define fixed bounded limits:

```rust
const MAX_SCAN_INTERFACES: usize = 8;
const MAX_SCAN_HOSTS: usize = 1024;
const MAX_SCAN_IN_FLIGHT: usize = 32;
const SCAN_REQUEST_TIMEOUT: Duration = Duration::from_millis(800);
```

Return:

```rust
pub struct NetworkScanResult {
    pub scan_id: Uuid,
    pub started_at_ms: i64,
    pub finished_at_ms: i64,
    pub scopes: Vec<ScanScope>,
    pub attempted: usize,
    pub discovered: usize,
    pub skipped: usize,
    pub cancelled: bool,
}

pub struct ScanScope {
    pub interface_name: String,
    pub kind: &'static str, // physical_lan/easytier/other
    pub prefix: u8,
    pub eligible: bool,
}
```

The active probe must use the existing `exomind-discovery/1` announcement as the
response payload or add a backward-compatible probe request. Old peers that only
send announcements remain discoverable.

**Step 3: Write failing UI test**

```tsx
it('offers a real scan action and never leaves an empty nearby list terminal', async () => {
  render(<BetaPeersPage {...fixture({ initialCandidates: [] })} />);
  await screen.findByText('暂未发现附近设备');
  const scan = screen.getByRole('button', { name: '扫描当前内网' });
  expect(scan).toBeEnabled();
  await user.click(scan);
  expect(client.scanNearby).toHaveBeenCalledWith(expect.objectContaining({
    scopeIds: expect.any(Array),
  }));
});
```

Also test:

- scan progress exposes elapsed/attempted count or a finite stage;
- cancel is available while scanning;
- failure offers retry, change-scope, EasyTier guidance and copy diagnostic;
- no-profile state can still scan;
- late previous result is ignored after profile/device change.

**Step 4: Implement UI scopes and results**

Render one flat section with:

- scope checkboxes;
- `扫描当前内网`;
- `取消扫描` while active;
- attempted/discovered/skipped counts;
- inaccessible scopes with reasons;
- existing passive candidate list.

The empty state becomes an actionable panel, not a terminal sentence.

**Step 5: Run tests**

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind-beta-host --lib peers::network::tests::scan -- --test-threads=1
bunx vitest run tests/unit/beta/peers-page.test.tsx tests/unit/beta/peers-client.test.ts --maxWorkers=1
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add crates/exomind-beta-host/src/peers/network.rs crates/exomind-beta-host/src/peers/network_tests.rs src-tauri/src/beta_native_peers.rs src/beta/peers-client.ts src/beta/NearbyDeviceCandidates.tsx src/beta/BetaPeersPage.tsx tests/unit/beta/peers-page.test.tsx
git commit -m "feat(beta): add bounded nearby network scan"
git push origin dev-0.6
```

## Task 4: Auto-copy generated invitations with truthful fallback

**Files:**

- Modify: `src/beta/BetaPeersPage.tsx`
- Modify: `tests/unit/beta/peers-page.test.tsx`
- Reuse: existing clipboard adapter or Native clipboard command

**Step 1: Write failing tests**

- generating an invitation writes exactly that invitation to the supplied
  clipboard adapter;
- a rejected clipboard write shows failure, keeps the text selected/visible and
  exposes a retry action;
- a copy confirmed after the invitation changes cannot report success for the
  stale value;
- leaving the page clears pending copy feedback without clearing Native-held
  material.

**Step 2: Run RED then implement**

```powershell
bunx vitest run tests/unit/beta/peers-page.test.tsx --maxWorkers=1
```

Use one clipboard abstraction for both automatic and manual copy. Do not read
back or log the clipboard.

**Step 3: Run GREEN and commit**

```powershell
bunx vitest run tests/unit/beta/peers-page.test.tsx --maxWorkers=1
git add src/beta/BetaPeersPage.tsx tests/unit/beta/peers-page.test.tsx
git commit -m "feat(beta): copy invitations after generation"
git push origin dev-0.6
```

## Task 5: Persist environments and connections

**Files:**

- Modify: `crates/exomind-beta-host/src/peers/membership_store.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_store.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_management.rs`
- Modify: `crates/exomind-beta-host/src/peers/network.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_tests.rs`
- Modify: `crates/exomind-beta-host/src/peers/membership_tests.rs`

**Step 1: Write failing migration tests**

Build an auth database at version 5 with:

- one device route repeated under two profiles;
- endpoints in user order;
- a ready member;
- no live probe evidence.

Upgrade and assert:

- one environment exists;
- duplicate endpoints are coalesced while order is stable;
- connections begin `untested`;
- membership generation and revocation are unchanged;
- no profile body, invitation secret or grant is created;
- a corrupt migration rolls back and reports recovery required.

**Step 2: Add schema version 6**

Create:

- `peer_environments`;
- `peer_connections`;
- `peer_connection_endpoints`;
- bounded indexes for remote environment and local status.

Keep `peer_network_routes` readable for migration, then retire it only in a
separate reviewed step after proof that no Beta25 upgrade path needs it.

**Step 3: Add Host operations**

```rust
pub fn peer_environments(&self, owner: &Session) -> Result<Vec<PeerEnvironmentView>, HostError>;
pub fn peer_connections(&self, owner: &Session, environment_id: DeviceId) -> Result<Vec<PeerConnectionView>, HostError>;
pub fn set_peer_connection_enabled(&self, owner: &Session, connection_id: Uuid, enabled: bool) -> Result<(), HostError>;
pub fn test_peer_connection(&self, owner: &Session, connection_id: Uuid, cancel: PeerCancellation) -> Result<PeerConnectionTest, HostError>;
```

Connection IDs are local durable IDs. Endpoint reordering and address updates do
not create a new environment identity.

**Step 4: Run tests**

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind-beta-host --lib peers::network::tests -- --test-threads=1
cargo test --locked -p exomind-beta-host --lib peers::membership::tests -- --test-threads=1
```

Expected: migration tests and existing membership tests pass with non-zero
counts.

**Step 5: Commit**

```powershell
git add crates/exomind-beta-host/src/peers/membership_store.rs crates/exomind-beta-host/src/peers/network_store.rs crates/exomind-beta-host/src/peers/network_management.rs crates/exomind-beta-host/src/peers/network.rs crates/exomind-beta-host/src/peers/network_tests.rs crates/exomind-beta-host/src/peers/membership_tests.rs
git commit -m "feat(beta): persist peer environments and connections"
git push origin dev-0.6
```

## Task 6: Make connection enablement bilateral and testable

**Files:**

- Modify: `crates/exomind-beta-host/src/peers/service.rs`
- Modify: `crates/exomind-beta-host/src/peers/network.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_tests.rs`
- Modify: `src-tauri/src/beta_native_peers.rs`
- Modify: `src/beta/peers-client.ts`
- Modify: `src/beta/BetaPeersPage.tsx`
- Modify: `tests/unit/beta/peers-page.test.tsx`

**Step 1: Write failing protocol tests**

Cover:

- local off makes no outbound connection;
- remote off returns `connection_disabled`, not timeout;
- both on permits a pinned service exchange;
- connection test does not touch profile facts;
- explicit test records exactly one bounded result;
- disconnect/cancel cannot replace a newer test result;
- unknown remote state remains unknown after one side is offline.

**Step 2: Add structured service outcomes**

Extend service negotiation with a backwards-compatible capability/result or new
service protocol version. Unknown old peers remain `protocol_mismatch`; do not
silently map them to “on”.

Do not grant profile access from a successful connection test.

**Step 3: Add UI**

Each connection card shows:

- kind and endpoint;
- local switch;
- last observed remote switch with timestamp;
- tested/untested/reachable/refused/unreachable/unknown;
- `测试连接`;
- last error and next action;
- copy diagnostic.

**Step 4: Run tests and commit**

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind-beta-host --lib peers::service::tests -- --test-threads=1
cargo test --locked -p exomind-beta-host --lib peers::network::tests -- --test-threads=1
bunx vitest run tests/unit/beta/peers-page.test.tsx tests/unit/beta/peers-client.test.ts --maxWorkers=1
```

```powershell
git add crates/exomind-beta-host/src/peers/service.rs crates/exomind-beta-host/src/peers/network.rs crates/exomind-beta-host/src/peers/network_tests.rs src-tauri/src/beta_native_peers.rs src/beta/peers-client.ts src/beta/BetaPeersPage.tsx tests/unit/beta/peers-page.test.tsx
git commit -m "feat(beta): add bilateral peer connection controls"
git push origin dev-0.6
```

## Task 7: Implement one-click invitation delivery and source provenance

**Files:**

- Modify: `crates/exomind-beta-host/src/peers/membership.rs`
- Modify: `crates/exomind-beta-host/src/peers/membership_types.rs`
- Modify: `crates/exomind-beta-host/src/peers/pairing.rs`
- Modify: `crates/exomind-beta-host/src/peers/service.rs`
- Modify: `crates/exomind-beta-host/src/peers/network.rs`
- Modify: `crates/exomind-beta-host/src/peers/membership_tests.rs`
- Modify: `crates/exomind-beta-host/src/peers/pairing_tests.rs`
- Modify: `crates/exomind-beta-host/src/peers/service_route_tests.rs`
- Modify: `crates/exomind-beta-host/src/peers/network_tests.rs`
- Modify: `src-tauri/src/beta_native_peers.rs`
- Modify: `src/beta/peers-client.ts`
- Modify: `src/beta/BetaPeersPage.tsx`
- Modify: `tests/unit/beta/peers-page.test.tsx`

**Step 1: Write failing protocol tests**

Cover:

- inviter sends a proposal to a selected discovered environment;
- receiver can accept or reject without copying text;
- accepting retrieves the signed invitation from the issuer and performs the
  existing one-use claim;
- duplicate acceptance reuses the same claim receipt;
- rejection is visible to inviter when reachable;
- offline expiry is `unreachable/unknown`, not rejection;
- a proposal from another device/profile cannot grant access;
- sender and receiver both appear as environments in the UI.

**Step 2: Implement proposal and accept frames**

Use a one-time proposal ID and bounded expiry. Delivering a proposal must not
send profile facts, originals, grants or unrelated profile listings.

**Step 3: Store source provenance**

Persist the accepted issuer environment and accepting connection for the local
profile. Expose it in the profile switcher/details as informational provenance.
Deleting or changing the local connection does not delete the profile or falsify
its source history.

**Step 4: Add no-copy UI**

The default path is:

```text
发现环境 → 选择档案 → 发送邀请 → 对端接受/拒绝
```

Keep copy/paste JSON as a fallback. Auto-copy remains active when fallback is
used.

**Step 5: Run tests and commit**

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind-beta-host --lib peers:: -- --test-threads=1
bunx vitest run tests/unit/beta/peers-page.test.tsx tests/unit/beta/peers-client.test.ts --maxWorkers=1
```

```powershell
git add crates/exomind-beta-host/src/peers/membership.rs crates/exomind-beta-host/src/peers/membership_types.rs crates/exomind-beta-host/src/peers/pairing.rs crates/exomind-beta-host/src/peers/service.rs crates/exomind-beta-host/src/peers/network.rs crates/exomind-beta-host/src/peers/membership_tests.rs crates/exomind-beta-host/src/peers/pairing_tests.rs crates/exomind-beta-host/src/peers/service_route_tests.rs crates/exomind-beta-host/src/peers/network_tests.rs src-tauri/src/beta_native_peers.rs src/beta/peers-client.ts src/beta/BetaPeersPage.tsx tests/unit/beta/peers-page.test.tsx
git commit -m "feat(beta): deliver invitations between environments"
git push origin dev-0.6
```

## Task 8: Record sync paths and expose redacted diagnostics

**Files:**

- Create: `crates/exomind-beta-host/src/peers/sync_attempt_store.rs`
- Modify: `crates/exomind-beta-host/src/peers/membership_store.rs`
- Modify: `crates/exomind-beta-host/src/peers/network.rs`
- Modify: `crates/exomind-beta-host/src/peers/synchronization.rs`
- Modify: `src-tauri/src/beta_native_peers.rs`
- Modify: `src/beta/peers-client.ts`
- Modify: `src/beta/BetaPeersPage.tsx`
- Modify: `tests/unit/beta/peers-page.test.tsx`
- Create: `crates/exomind-beta-host/src/peers/sync_attempt_tests.rs`

**Step 1: Write failing store tests**

Cover:

- every attempt has source environment/profile, target environment/profile,
  connection, endpoint and bounded phase timestamps;
- retries get distinct attempt IDs but retain command/page identities;
- success, partial, refused, unreachable and cancelled are distinct;
- ring retention is enforced;
- no secrets, fact bodies or original bytes are stored;
- UI receives only the bounded recent page.

**Step 2: Implement attempt recording**

Record once at actual operation ownership, not inside React. The connection test
is not a sync attempt. A sync may try multiple connections; each route attempt
and the final selected connection are visible.

**Step 3: Add UI log**

Show recent path rows:

```text
电脑 · 2026-11-21 → 平板 · 2026-11-21
EasyTier · 10.x.x.x:43344
identity ✓ · membership ✓ · facts 12/12 · originals 0/2
```

Provide filters, details, retry, test connection and copy redacted diagnostic.

**Step 4: Run tests and commit**

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind-beta-host --lib peers::sync_attempt_tests -- --test-threads=1
cargo test --locked -p exomind-beta-host --lib peers::network::tests -- --test-threads=1
bunx vitest run tests/unit/beta/peers-page.test.tsx tests/unit/beta/peers-client.test.ts --maxWorkers=1
```

```powershell
git add crates/exomind-beta-host/src/peers/sync_attempt_store.rs crates/exomind-beta-host/src/peers/membership_store.rs crates/exomind-beta-host/src/peers/network.rs crates/exomind-beta-host/src/peers/synchronization.rs crates/exomind-beta-host/src/peers/sync_attempt_tests.rs src-tauri/src/beta_native_peers.rs src/beta/peers-client.ts src/beta/BetaPeersPage.tsx tests/unit/beta/peers-page.test.tsx
git commit -m "feat(beta): trace peer sync connections"
git push origin dev-0.6
```

## Task 9: Fix the Windows taskbar application identity

**Files:**

- Create: `src-tauri/src/windows_app_identity.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/beta_native.rs`
- Modify: `src-tauri/src/beta_window_icon.rs`
- Modify: `src-tauri/tauri.beta.conf.json` only if packaged icon metadata is
  incomplete
- Create: `src-tauri/tests/beta_windows_app_identity.rs`

**Step 1: Write failing source/config tests**

Assert:

- Beta has one stable AppUserModelID;
- alpha and Beta IDs differ;
- Windows startup applies it before creating taskbar-visible windows;
- both large and small icons come from the bundled `.ico`;
- a failed icon application is logged with a safe diagnostic and never treated
  as success.

**Step 2: Implement the stable Windows identity**

Use the Tauri/Beta identifier as the stable AppUserModelID. Ensure the executable
resource, runtime window identity and any generated shortcut agree.

**Step 3: Run tests**

```powershell
$env:CARGO_TARGET_DIR='G:/exomind-cargo-target'
cargo test --locked -p exomind --no-default-features --features custom-protocol,beta-native-only --test beta_windows_app_identity
```

Expected: PASS. Actual taskbar verification remains a Windows candidate test.

**Step 4: Commit**

```powershell
git add src-tauri/src/windows_app_identity.rs src-tauri/src/lib.rs src-tauri/src/beta_native.rs src-tauri/src/beta_window_icon.rs src-tauri/tauri.beta.conf.json src-tauri/tests/beta_windows_app_identity.rs
git commit -m "fix(beta): unify Windows taskbar identity"
git push origin dev-0.6
```

## Task 10: Apply the UX constitution to ExoMind and ARC

**Files:**

- Modify: `docs/architecture/principles.md`
- Modify: `docs/development/ui-spec.md`
- Modify: `docs/development/beta-ui-user-requirements.md`
- Modify: `C:/Users/56506/.claude/skills/arc-ui-design/SKILL.md`
- Modify: `C:/Users/56506/.claude/skills/arc-ui-design/references/interaction-patterns.md`
- Modify: `C:/Users/56506/.claude/skills/arc-ui-design/references/state-feedback-systems.md`
- Modify: `C:/Users/56506/.claude/skills/arc-ui-design/references/regression-cases.md`
- Modify: `C:/Users/56506/.claude/skills/arc-ui-design/references/iteration-candidates.md`
- Modify: `C:/Users/56506/.claude/skills/arc-ui-design/references/provenance.md`
- Modify: `C:/Users/56506/.claude/skills/arc-ui-design/TRIAL-NOTES.md`

**Step 1: Run the skill TDD baseline**

Use an independent fresh subagent on three pressure scenarios without the new
rules:

1. nearby devices empty, user told to wait;
2. private profile unreachable, where hiding the whole row feels privacy-safe;
3. immersive mode enters an error with no exit.

Record whether the agent proposes spinner-only, silent empty states, hidden
status, or no diagnostics.

**Step 2: Run the ExoMind UI regression first**

Add cases requiring actionable state and private-state visibility before changing
the docs or shared component.

Expected: current UI tests fail where they encode terminal empty/error states.

**Step 3: Add P11/P12 and supporting methods**

Add:

- P11 all-state surfacing;
- P12 no suspended waiting;
- I16 state closure;
- SF06/SF07 strengthening;
- anti-patterns for spinner-only and privacy-erases-status;
- regression cases R21–R23.

Extend P10 with “immersion preserves state, exit, cancel, recovery and
diagnostics.”

**Step 4: Re-run the scenario with the skill**

The same fresh subagent must now propose a visible state projection, a real
action, and a redacted diagnostic path. Record exact output and any remaining
ambiguity in `iteration-candidates.md`.

**Step 5: Validate and commit both repositories**

Run the ARC skill's verification script and the ExoMind focused tests. Commit the
skill repository separately from ExoMind. Push only repositories configured for
the current task; otherwise leave a clear dirty-state handoff.

## Task 11: Integrated local and device verification

**Files:**

- Create: `H:/A137442/Develop/AGI/exomind-agent-artifacts/beta26-environment-connections-20261121/PROGRESS.md`
- Create: matching machine-readable results and screenshots outside the repo
- Update: Beta26 execution/status plan after exact candidate exists

**Step 1: PC two-Host verification**

Run two isolated Host roots and verify:

- bidirectional discovery without profiles;
- active scan scopes and bounds;
- bilateral local switches;
- explicit refusal;
- one-click proposal/accept/reject;
- text and original convergence;
- source provenance and sync path logs;
- restart and cancellation races.

**Step 2: EasyTier verification**

Use the existing active EasyTier interfaces. Confirm candidate classification,
identity pinning and sync through the overlay. Do not equate interface presence
with a successful connection.

**Step 3: Android emulator verification**

Install the Beta26 arm64/x86_64 APK as appropriate. Verify scanning, tap targets,
permission states, background behavior, process recovery and double-toggle
semantics. Emulator results remain separate from physical-device acceptance.

**Step 4: Physical-device handoff**

When a candidate needs the user's tablet or phone, provide:

- exact APK path, hash, versionCode and signature;
- install/upgrade command;
- the shortest ordered acceptance script;
- expected visible states;
- a diagnostic-copy button if any step fails.

**Step 5: Candidate gate**

Run:

```powershell
bunx tsc --noEmit
bunx vitest run tests/unit/beta --maxWorkers=1
bun run check:staged-imports
bun run verify:beta:contracts --out G:/exomind-beta26-contracts-<unique>
```

Then build the exact Beta26 source and require four-platform build plus device
matrix. Do not reuse Beta25 candidate evidence.
