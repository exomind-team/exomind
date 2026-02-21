# Issue #27 EventLog Multi-Device Sync MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land the minimum acceptance chain for issue #27: same user, two LAN devices, A sends event, B receives it, and EventLog displays synced data.

**Architecture:** Reuse existing `EventStorage.syncToRemote()` and make URL resolution robust for LAN usage. Normalize remote DB URL construction in one place, then verify end-to-end behavior with a Playwright test that simulates two devices (two contexts).

**Tech Stack:** React + Vite, PouchDB, Playwright, Vitest.

---

### Task 1: Make remote sync URL generation explicit and testable

**Files:**
- Create: `src/lib/sync/remote-db-url.ts`
- Create: `tests/unit/sync/remote-db-url.test.ts`
- Modify: `src/config/port-env.ts`
- Modify: `tests/config/port-env.test.ts`

**Step 1: Write the failing tests**

- Add tests for DB URL builder:
  - should trim trailing slash from base URL
  - should encode username for safe DB name segment
  - should produce `http://host:port/<username>`
- Add tests for sync server URL resolution:
  - should keep `VITE_SYNC_SERVER_URL` priority
  - should use runtime hostname when no explicit sync URL is provided

**Step 2: Run tests to verify they fail**

Run:

```bash
bun run test tests/unit/sync/remote-db-url.test.ts tests/config/port-env.test.ts
```

Expected: FAIL on missing URL builder and missing runtime-host behavior.

**Step 3: Write minimal implementation**

- Implement `buildRemoteDbUrl(baseUrl, username)` and `normalizeBaseUrl(url)`.
- Extend `resolveSyncServerUrl(env, runtimeHostname?)` to support runtime host fallback.

**Step 4: Run tests to verify they pass**

Run:

```bash
bun run test tests/unit/sync/remote-db-url.test.ts tests/config/port-env.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/sync/remote-db-url.ts src/config/port-env.ts tests/unit/sync/remote-db-url.test.ts tests/config/port-env.test.ts
git commit -m "test(sync): cover sync URL resolution for LAN-safe remote DB path"
```

### Task 2: Wire EventLog and sync adapter to the shared URL builder

**Files:**
- Modify: `src/components/Chat/ChatPage.tsx`
- Modify: `src/adapters/pouch-sync.ts`
- Modify: `tests/components/ChatPage.test.tsx`

**Step 1: Write/update failing tests**

- Update ChatPage-related expectations to use normalized remote DB URL format.
- Add/adjust tests around sync path generation behavior used by EventLog.

**Step 2: Run tests to verify they fail**

Run:

```bash
bun run test tests/components/ChatPage.test.tsx
```

Expected: FAIL due to old `/database/<user>` hardcoded path assumptions.

**Step 3: Write minimal implementation**

- In `ChatPage`, resolve sync URL with runtime hostname and build remote DB URL via shared helper.
- In `PouchSyncAdapter`, build remote DB URL using the same helper.

**Step 4: Run tests to verify they pass**

Run:

```bash
bun run test tests/components/ChatPage.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/Chat/ChatPage.tsx src/adapters/pouch-sync.ts tests/components/ChatPage.test.tsx
git commit -m "fix(sync): unify remote pouchdb URL construction across eventlog and adapter"
```

### Task 3: Add real two-device EventLog E2E acceptance test and docs

**Files:**
- Create: `tests/e2e/eventlog-multi-device-sync.issue27.test.ts`
- Create: `tests/e2e/playwright.issue27.config.ts`
- Modify: `package.json`
- Modify: `docs/development/port-env-configuration.md`
- Modify: `AGENTS.md`

**Step 1: Write failing E2E test**

- Simulate two devices with two browser contexts:
  - both register/login same username + password (MVP local user model)
  - A sends unique event in EventLog
  - B eventually sees event in EventLog list
- Use dedicated issue-27 Playwright config with isolated web/sync ports.

**Step 2: Run E2E to verify it fails first**

Run:

```bash
bun run test:e2e:issue27
```

Expected: FAIL before implementation wiring is complete.

**Step 3: Minimal implementation/doc updates**

- Ensure E2E script is available in `package.json`.
- Document LAN port/env setup and manual verification checklist for issue #27.
- Add AGENTS workflow note for multi-worktree distinct port assignment.

**Step 4: Run E2E to verify green**

Run:

```bash
bun run test:e2e:issue27
```

Expected: PASS with local sync server + app server.

**Step 5: Commit**

```bash
git add tests/e2e/eventlog-multi-device-sync.issue27.test.ts tests/e2e/playwright.issue27.config.ts package.json docs/development/port-env-configuration.md AGENTS.md
git commit -m "test(e2e): add issue-27 multi-device eventlog sync acceptance coverage"
```

### Task 4: Final verification and PR update

**Files:**
- Modify: `agent-output/debug/2026-02-11-issue-27-sync-implementation-report.md` (if needed)

**Step 1: Run verification suite**

Run:

```bash
bun run test tests/unit/sync/remote-db-url.test.ts tests/config/port-env.test.ts tests/components/ChatPage.test.tsx
bun run test:e2e:issue27
```

Expected: all passing.

**Step 2: Update issue/PR notes**

- Post concise implementation summary + test evidence.
- Include manual test checklist for human validation.

**Step 3: Commit final notes (if file-based report changed)**

```bash
git add agent-output/debug/2026-02-11-issue-27-sync-implementation-report.md
git commit -m "docs(sync): record issue-27 implementation and verification evidence"
```

