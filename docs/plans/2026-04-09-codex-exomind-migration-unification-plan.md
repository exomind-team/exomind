# Codex ExoMind Migration Unification Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn ExoMind from "it can launch Codex in a PTY" into a stable long-term Codex workbench with unified session identity, reliable recovery, acceptable transport latency, and understandable user-facing controls.

**Architecture:** Keep `exomind-runtime` as the single runtime authority, but stop treating Codex as three partially separate products. Unify `runtime agent`, `PTY terminal`, and `session/recovery` under one contract: provider/session identity, terminal transport, recovery semantics, and workbench presentation must align. Preserve current working paths first, then collapse duplicate abstractions in phases.

**Tech Stack:** Rust, Tokio, Axum, PTY runtime, React 18, TypeScript, xterm.js, Vitest, Tauri MCP, GitHub Issues, localStorage/runtime config

---

## 1. Executive Summary

Current ExoMind already has enough infrastructure to run Codex inside the product:

- `runtime agent` mode exists in [codex.rs](/D:/project/exomind/crates/exomind-runtime/src/agent/codex.rs)
- `PTY terminal` mode exists across [mod.rs](/D:/project/exomind/crates/exomind-runtime/src/pty/mod.rs) and [pty.rs](/D:/project/exomind/crates/exomind-runtime/src/routes/pty.rs)
- desktop recovery and historical binding exist in [pty-session-recovery.ts](/D:/project/exomind/src/ui/app/pages/agents/pty-session-recovery.ts) and [AgentsPage.tsx](/D:/project/exomind/src/ui/app/pages/AgentsPage.tsx)
- terminal interaction exists in [PtyTerminal.tsx](/D:/project/exomind/src/ui/app/components/PtyTerminal.tsx)

The migration problem is no longer "how do we connect Codex?" The real problem is that Codex currently lives across three overlapping but not fully unified systems:

1. `runtime agent` contract
2. `PTY terminal` contract
3. `session/recovery + workbench` contract

The next phase should therefore optimize for:

1. Reliability first
2. Identity consistency second
3. Transport/performance third
4. UX/info architecture fourth

Do not start by inventing a new grand architecture. First freeze contracts around the existing working path, then unify duplicate semantics layer by layer.

## 2. Evidence Base

This plan is based on current code and current issue/doc state, especially:

- [codex.rs](/D:/project/exomind/crates/exomind-runtime/src/agent/codex.rs)
- [mod.rs](/D:/project/exomind/crates/exomind-runtime/src/pty/mod.rs)
- [pty.rs](/D:/project/exomind/crates/exomind-runtime/src/routes/pty.rs)
- [PtyTerminal.tsx](/D:/project/exomind/src/ui/app/components/PtyTerminal.tsx)
- [PtySpawnDialog.tsx](/D:/project/exomind/src/ui/app/components/PtySpawnDialog.tsx)
- [AgentsPage.tsx](/D:/project/exomind/src/ui/app/pages/AgentsPage.tsx)
- [pty-session-recovery.ts](/D:/project/exomind/src/ui/app/pages/agents/pty-session-recovery.ts)
- [settings-registry.ts](/D:/project/exomind/src/ui/app/config/settings/settings-registry.ts)
- [pty-terminal-preferences.ts](/D:/project/exomind/src/config/pty-terminal-preferences.ts)
- [tauri-mcp-windows-playbook.md](/D:/project/exomind/docs/development/tauri-mcp-windows-playbook.md)
- [2026-03-07-issue-385-agent-hub-claude-codex-runtime-plan.md](/D:/project/exomind/docs/plans/2026-03-07-issue-385-agent-hub-claude-codex-runtime-plan.md)
- [2026-04-09-pty-websocket-latency-remediation-plan.md](/D:/project/exomind/docs/plans/2026-04-09-pty-websocket-latency-remediation-plan.md)

Key GitHub issues already define much of the scope:

- `#385` runtime orchestration base
- `#806` PTY lifecycle normalization
- `#810` Windows / Codex resume trust + telemetry
- `#818` auto recovery after RT restart
- `#821` real user story: review current work in ExoMind with Codex/Claude
- `#838` renamed history titles
- `#843` terminal replay/history window
- `#849` `/resume` identity drift
- `#875` settings partition cleanup
- `#876` / `#878` settings wording cleanup
- `#894` input transport WebSocket migration

## 3. Unified Problem Model

### 3.1 What Is Actually Split Today

#### Layer A: Provider execution

- Runtime agent Codex has its own process contract in [codex.rs](/D:/project/exomind/crates/exomind-runtime/src/agent/codex.rs).
- PTY Codex has a different spawn/resume contract in [mod.rs](/D:/project/exomind/crates/exomind-runtime/src/pty/mod.rs).
- These two paths already diverge in CLI argument policy and stream semantics.

#### Layer B: Terminal transport

- Current PTY interaction is still `POST /pty/:id/input` + `GET /pty/:id/stream`
- This is visible in [PtyTerminal.tsx](/D:/project/exomind/src/ui/app/components/PtyTerminal.tsx)
- The dedicated WebSocket migration plan already exists in [2026-04-09-pty-websocket-latency-remediation-plan.md](/D:/project/exomind/docs/plans/2026-04-09-pty-websocket-latency-remediation-plan.md)

#### Layer C: Session identity

- ExoMind currently spreads identity across:
  - runtime `session.id`
  - historical `inner_session_id`
  - live `pty_id`
  - `source_host_id`
- Recovery depends heavily on `inner_session_id` + normalized workdir in [pty-session-recovery.ts](/D:/project/exomind/src/ui/app/pages/agents/pty-session-recovery.ts)
- This identity model is already powerful enough to recover sessions, but not yet stable enough to survive every `/resume` and every UI path consistently.

#### Layer D: Workbench presentation

- `PtySpawnDialog` owns entry, historical selection, agent choice, naming hints
- `AgentsPage` owns session list, duplicate redirection, reconnect, tiled/fullscreen coordination
- `PtyTerminal` owns actual transport and terminal widget behavior
- Settings and wording are split across [settings-registry.ts](/D:/project/exomind/src/ui/app/config/settings/settings-registry.ts)

### 3.2 Unified Abstraction to Target

The correct target is not "Codex adapter everywhere". The correct target is a **Unified Terminal Agent Contract** with four explicit subcontracts:

1. **Provider Contract**
   - How Claude/Codex/API sessions are spawned, resumed, named, interrupted, and listed

2. **Transport Contract**
   - How input/output/control are transmitted
   - Which failures are transport-only failures versus lifecycle failures

3. **Identity Contract**
   - How `session.id`, `inner_session_id`, `pty_id`, and `source_host_id` relate
   - Which identifier is canonical for recovery, occupancy, history cards, and `/resume`

4. **Presentation Contract**
   - How the same terminal session appears across `Sessions`, `Tiled`, `fullscreen`, and history picker
   - Which user-facing settings and labels control this experience

Any implementation work that does not clearly map to one of these four contracts should be treated as suspicious scope drift.

## 4. What Is Already Working

These are not theoretical:

1. Codex runtime agent exists and is not just a stub:
   - [codex.rs](/D:/project/exomind/crates/exomind-runtime/src/agent/codex.rs)

2. PTY spawn/resume/stream/input lifecycle exists:
   - [pty.rs](/D:/project/exomind/crates/exomind-runtime/src/routes/pty.rs)

3. Codex historical session discovery already parses local history/title metadata:
   - [mod.rs](/D:/project/exomind/crates/exomind-runtime/src/pty/mod.rs)

4. `inner_session_id` persistence and recovery already exist:
   - [pty-session-recovery.ts](/D:/project/exomind/src/ui/app/pages/agents/pty-session-recovery.ts)

5. Desktop verification evidence already exists in the playbook:
   - [tauri-mcp-windows-playbook.md](/D:/project/exomind/docs/development/tauri-mcp-windows-playbook.md)

6. Terminal replay limit already partially exists as a configurable preference:
   - [pty-terminal-preferences.ts](/D:/project/exomind/src/config/pty-terminal-preferences.ts)
   - [settings-registry.ts](/D:/project/exomind/src/ui/app/config/settings/settings-registry.ts)

This means the next plan should not re-open the question of viability. It should treat viability as proven and focus on consolidation.

## 5. Main Gaps To Close

### Gap 1: Provider policy is not aligned between runtime-agent and PTY

Evidence:

- runtime Codex hardcodes `--skip-git-repo-check` and `--dangerously-bypass-approvals-and-sandbox` in [codex.rs](/D:/project/exomind/crates/exomind-runtime/src/agent/codex.rs)
- PTY resume path for Codex uses separate argument assembly in [mod.rs](/D:/project/exomind/crates/exomind-runtime/src/pty/mod.rs)

Meaning:

- ExoMind currently has two Codex launch policies.
- Reliability, security posture, and recovery behavior can diverge depending on which path the user enters from.

### Gap 2: Session identity is powerful but still drift-prone

Evidence:

- `inner_session_id` is central in [pty-session-recovery.ts](/D:/project/exomind/src/ui/app/pages/agents/pty-session-recovery.ts)
- `AgentsPage.tsx` uses it for occupancy and recovery decisions
- `#849` explicitly tracks `/resume` causing stale `inner_session_id`

Meaning:

- The system can recover sessions, but it cannot yet guarantee that "the history identity I see" is the same as "the upstream session I am actually attached to".

### Gap 3: PTY transport is still on the old latency model

Evidence:

- [PtyTerminal.tsx](/D:/project/exomind/src/ui/app/components/PtyTerminal.tsx) still sends input over HTTP
- [2026-04-09-pty-websocket-latency-remediation-plan.md](/D:/project/exomind/docs/plans/2026-04-09-pty-websocket-latency-remediation-plan.md) already defines the WS migration

Meaning:

- Long-term Codex usage will keep feeling second-class until transport is migrated.

### Gap 4: History/window persistence is functional but mentally fragmented

Evidence:

- history naming issue `#838`
- replay/window issue `#843`
- tiled/fullscreen/session coordination lives across multiple files

Meaning:

- The user can technically recover work, but not yet think of ExoMind as a stable named Codex workspace.

### Gap 5: Settings are still developer-shaped

Evidence:

- `#875`, `#876`, `#878`
- settings live in [settings-registry.ts](/D:/project/exomind/src/ui/app/config/settings/settings-registry.ts)

Meaning:

- Even after functionality is available, discoverability and confidence remain low.

## 6. Workstream Structure

This migration should be executed as five workstreams, not as one giant mega-issue.

### Workstream A: Contract Freeze

Purpose:
- Freeze unified contracts before more fixes diverge

Deliverables:
- one canonical mapping of provider/transport/identity/presentation contracts
- explicit "current truth" doc for identifiers and ownership
- issue-to-contract matrix

Key files:
- [codex.rs](/D:/project/exomind/crates/exomind-runtime/src/agent/codex.rs)
- [mod.rs](/D:/project/exomind/crates/exomind-runtime/src/pty/mod.rs)
- [pty.rs](/D:/project/exomind/crates/exomind-runtime/src/routes/pty.rs)
- [AgentsPage.tsx](/D:/project/exomind/src/ui/app/pages/AgentsPage.tsx)
- [pty-session-recovery.ts](/D:/project/exomind/src/ui/app/pages/agents/pty-session-recovery.ts)

Exit condition:
- No further Codex fixes land without naming which contract they change

### Workstream B: Reliability and Security Alignment

Purpose:
- Align launch/resume policy across runtime-agent and PTY
- resolve Windows/Codex trust and recovery ambiguity

Primary issues:
- `#810`
- adjacent policy fallout from `#821`

Deliverables:
- one shared Codex launch-policy builder or equivalent central policy layer
- documented decision on trusted directories vs skip flags vs user prompts
- explicit auth and runtime-boundary audit for PTY routes

Exit condition:
- PTY Codex and runtime Codex no longer have silent policy divergence

### Workstream C: Transport and Performance

Purpose:
- Make terminal input/output feel native enough for real Codex usage

Primary issues:
- `#894`
- `#843`

Deliverables:
- WS input migration
- later WS output migration
- replay/history verification tied to transport changes

Exit condition:
- long-output review and command iteration no longer feel materially worse than Windows Terminal for common usage

### Workstream D: Session Identity and Recovery Consistency

Purpose:
- eliminate identity drift, duplicate-window ambiguity, and restore mismatch

Primary issues:
- `#818`
- `#821`
- `#838`
- `#849`

Deliverables:
- canonical identity mapping
- `/resume` identity update rules
- history naming hierarchy
- duplicate occupancy / canonical window contract

Exit condition:
- the same Codex conversation is consistently the same thing across history cards, tiled panes, fullscreen, and auto-recovery

### Workstream E: UX and Settings Productization

Purpose:
- convert engineering-shaped internals into understandable controls

Primary issues:
- `#875`
- `#876`
- `#878`

Deliverables:
- settings partition cleanup
- wording cleanup
- workbench mental model cleanup
- user-facing evidence/report template for experience regressions

Exit condition:
- a normal user can configure Codex usage without understanding RT / PTY internals

## 7. Phased Plan

### Phase 0: Discovery Freeze and Contract Table

**Files:**
- Create: `docs/plans/2026-04-09-codex-exomind-migration-unification-plan.md`
- Create: `docs/development/codex-terminal-contract.md`
- Modify: relevant issue descriptions if needed

**Step 1: Write the contract table**

Capture:
- provider contract
- transport contract
- identity contract
- presentation contract

**Step 2: Add an issue mapping table**

Map each active issue to:
- contract touched
- risk level
- likely blocking order

**Step 3: Validate against current code**

Cross-check file ownership:
- runtime agent
- PTY
- recovery
- UI presentation
- settings

**Step 4: Commit**

```bash
git add docs/plans/2026-04-09-codex-exomind-migration-unification-plan.md docs/development/codex-terminal-contract.md
git commit -m "docs: freeze codex migration contracts"
```

### Phase 1: Reliability and Policy Alignment

**Files:**
- Modify: `crates/exomind-runtime/src/agent/codex.rs`
- Modify: `crates/exomind-runtime/src/pty/mod.rs`
- Modify: `crates/exomind-runtime/src/routes/pty.rs`
- Test: PTY and Codex route/runtime tests
- Docs: `docs/development/tauri-mcp-windows-playbook.md`

**Step 1: Inventory every Codex launch/resume argument path**

List:
- runtime agent spawn args
- PTY spawn args
- PTY resume args

**Step 2: Decide one launch policy**

Resolve:
- trusted directory strategy
- skip flags strategy
- dangerous sandbox bypass strategy
- per-entrypoint differences that are truly intentional

**Step 3: Audit PTY route auth boundary**

Verify:
- stream
- input
- stop
- remove
- resume
- historical session listing

**Step 4: Add focused tests**

Test:
- Codex PTY resume in default/relative workdir
- auth protection on PTY routes
- failure telemetry

**Step 5: Commit**

```bash
git add crates/exomind-runtime/src/agent/codex.rs crates/exomind-runtime/src/pty/mod.rs crates/exomind-runtime/src/routes/pty.rs docs/development/tauri-mcp-windows-playbook.md
git commit -m "fix(codex): align runtime and pty launch policy"
```

### Phase 2: Transport Upgrade

This phase should reuse, not rewrite, the existing WS migration plan.

**Files:**
- Reuse: [2026-04-09-pty-websocket-latency-remediation-plan.md](/D:/project/exomind/docs/plans/2026-04-09-pty-websocket-latency-remediation-plan.md)
- Modify: `src/ui/app/components/PtyTerminal.tsx`
- Modify: `crates/exomind-runtime/src/routes/pty.rs`

**Step 1: Treat current WS plan as the transport subplan**

Do not fork a second transport plan.

**Step 2: Execute `S0 -> S1 -> S2 -> S3` with Codex-focused evidence**

Make Codex the primary acceptance target.

**Step 3: Explicitly inherit identity and lifecycle constraints**

Transport must not break:
- `#806`
- `#818`
- `#843`

**Step 4: Commit by WS stage**

Use stage-sized commits, not a single transport mega-commit.

### Phase 3: Identity and Recovery Unification

**Files:**
- Modify: `src/ui/app/pages/agents/pty-session-recovery.ts`
- Modify: `src/ui/app/pages/AgentsPage.tsx`
- Modify: `src/lib/types/session.ts`
- Modify: runtime session persistence if needed
- Test: identity/recovery tests

**Step 1: Write the identity matrix**

Define exact roles for:
- `session.id`
- `inner_session_id`
- `pty_id`
- `source_host_id`

**Step 2: Solve `/resume` identity drift**

Primary target:
- `#849`

**Step 3: Normalize recovery and occupancy rules**

Unify:
- duplicate redirect
- canonical window selection
- history binding
- RT restart recovery

**Step 4: Normalize display-title fallbacks**

Primary target:
- `#838`

**Step 5: Commit**

```bash
git add src/ui/app/pages/agents/pty-session-recovery.ts src/ui/app/pages/AgentsPage.tsx src/lib/types/session.ts
git commit -m "refactor(agent-terminal): unify codex session identity and recovery"
```

### Phase 4: UX and Settings Cleanup

**Files:**
- Modify: `src/ui/app/config/settings/settings-registry.ts`
- Modify: settings layout tests
- Modify: `PtySpawnDialog.tsx`
- Modify: session/history card presentation

**Step 1: Move workbench-specific settings into the terminal section**

Primary target:
- `#875`

**Step 2: Rewrite labels and descriptions in user language**

Primary targets:
- `#876`
- `#878`

**Step 3: Tighten spawn/history naming and guidance**

Primary target:
- `#838`

**Step 4: Add experience-report template**

Create a short template for:
- latency
- replay/history loss
- session mismatch
- naming confusion
- recovery breakage

**Step 5: Commit**

```bash
git add src/ui/app/config/settings/settings-registry.ts src/ui/app/components/PtySpawnDialog.tsx
git commit -m "feat(settings): productize codex terminal experience"
```

### Phase 5: Unified Verification and Regression Charter

**Files:**
- Modify: `docs/development/tauri-mcp-windows-playbook.md`
- Create: `docs/development/codex-terminal-regression-charter.md`
- Modify: tests/evidence scripts as needed

**Step 1: Define a Codex-specific regression charter**

Scenarios:
- review current diff
- long output scrollback
- RT restart recovery
- tiled/fullscreen switching
- `/resume` identity changes
- transport failure states

**Step 2: Tie evidence to workstreams**

Every workstream must produce:
- test evidence
- desktop evidence
- issue status change

**Step 3: Make "experience regressions" first-class**

Track:
- latency
- replay length
- broken naming
- recovery mismatch
- settings confusion

**Step 4: Commit**

```bash
git add docs/development/tauri-mcp-windows-playbook.md docs/development/codex-terminal-regression-charter.md
git commit -m "docs: add codex migration regression charter"
```

## 8. Recommended Execution Order

Strict order:

1. Phase 0 contract freeze
2. Phase 1 reliability and policy alignment
3. Phase 3 identity and recovery unification
4. Phase 2 transport upgrade
5. Phase 4 UX/settings cleanup
6. Phase 5 unified verification

Reasoning:

- Transport improvements are high value, but they sit on top of identity and policy assumptions.
- If policy and identity remain divergent, transport work amplifies confusion rather than resolving it.

## 9. Decision Rules

During implementation, use these rules:

1. If a change affects launch arguments, trust, approvals, or workdir:
   - it belongs to the **Provider Contract**

2. If a change affects input/output channel, buffering, replay, or reconnect:
   - it belongs to the **Transport Contract**

3. If a change affects `session.id`, `inner_session_id`, `pty_id`, duplicate-window logic, or `/resume`:
   - it belongs to the **Identity Contract**

4. If a change affects history cards, settings wording, spawn dialog, tiled/fullscreen UX:
   - it belongs to the **Presentation Contract**

5. Do not accept a fix that crosses two or more contracts without explicitly documenting the boundary.

## 10. Success Criteria

This migration is complete only when all of the following are true:

1. Codex PTY and Codex runtime agent no longer have silent policy divergence.
2. The same Codex conversation remains the same identity across history, panes, fullscreen, and recovery.
3. PTY interaction is performant enough for real review/debugging usage.
4. Long output remains reviewable enough inside ExoMind.
5. Settings and labels no longer require users to understand RT / PTY internals.
6. Desktop verification has a stable charter and evidence trail.

## 11. Recommended Parallelization

If this plan is executed with subagents, dispatch by workstream:

1. Agent A: Provider policy + security boundary
2. Agent B: Identity and recovery
3. Agent C: Transport
4. Agent D: UX/settings + evidence/reporting

Do not split by file. Split by contract.

## 12. Immediate Next Actions

1. Freeze the contract table in a dedicated doc.
2. Audit every Codex launch/resume policy difference between runtime and PTY.
3. Turn `#810` into a fully explicit policy decision, not just a bug report.
4. Promote `#849` from "edge case" to core identity work.
5. Reuse the existing WS transport plan instead of creating a competing one.

