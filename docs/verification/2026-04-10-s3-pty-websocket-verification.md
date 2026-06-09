# 2026-04-10 S3 PTY WebSocket Verification

## Scope

This note captures the verification evidence gathered on 2026-04-10 for `S3` of the PTY WebSocket remediation plan:

- PTY input/output transport is WebSocket-only for the current frontend.
- Legacy PTY HTTP/SSE endpoints `/pty/:id/input` and `/pty/:id/stream` are physically removed from runtime routing and return `404` at runtime.
- Runtime and frontend behavior were re-checked against the current desktop app instance.

This note does **not** retroactively claim any evidence that was not collected in this turn.

## Environment

- Repository: `H:\A137442\Develop\AGI\exomind`
- Base `dev` head before candidate push: `734089a2987181150784f1f65136f39efdd59088`
- Tauri app: `ExoMind 0.4.5`
- Main window title: `ExoMind [dev] [Web:1452 RT:1967]`
- Runtime host id: `rt-38b0b3e5-792b-4cd1-863e-2250eba9ed5b`
- Runtime started at: `2026-04-10T11:23:59.050409800+00:00`
- Desktop instance data dir: `.tmp/tauri-dev-state/issue897-s3e/app-data/runtime`

## Code-Level Evidence

### Runtime routes

- PTY runtime route table registers only:
  - `/pty/:id/ws`
  - `/pty/:id/resize`
  - `/pty/:id/stop`
- Source:
  - [pty.rs](H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/routes/pty.rs#L1637)

### Legacy PTY endpoints are expected to be gone

- Route-level tests:
  - `legacy_pty_input_route_returns_not_found`
  - `legacy_pty_stream_route_returns_not_found`
- Integration test:
  - `legacy_pty_http_endpoints_return_not_found`
- Sources:
  - [pty.rs](H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/routes/pty.rs#L2046)
  - [pty.rs](H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/src/routes/pty.rs#L2071)
  - [pty_agent.rs](H:/A137442/Develop/AGI/exomind/crates/exomind-runtime/tests/pty_agent.rs#L994)

### Frontend PTY transport uses WebSocket

- PTY input transport builds `ws://.../pty/:id/ws?mode=input`
- PTY output transport builds `ws://.../pty/:id/ws?mode=output`
- PTY frontend entry points use `sendPtyWsTextInput`
- Sources:
  - [pty-input.ts](H:/A137442/Develop/AGI/exomind/src/ui/app/components/pty-input.ts#L158)
  - [pty-input.ts](H:/A137442/Develop/AGI/exomind/src/ui/app/components/pty-input.ts#L983)
  - [PtyTerminal.tsx](H:/A137442/Develop/AGI/exomind/src/ui/app/components/PtyTerminal.tsx#L187)
  - [PtyTerminal.tsx](H:/A137442/Develop/AGI/exomind/src/ui/app/components/PtyTerminal.tsx#L922)
  - [AgentsPage.tsx](H:/A137442/Develop/AGI/exomind/src/ui/app/pages/AgentsPage.tsx#L8346)
  - [PtyTerminalPage.tsx](H:/A137442/Develop/AGI/exomind/src/ui/app/pages/agents/PtyTerminalPage.tsx#L198)
  - [PtyPromptComposer.tsx](H:/A137442/Develop/AGI/exomind/src/ui/app/components/PtyPromptComposer.tsx#L41)

## Executed Local Validation

The following commands were run in this turn and completed successfully:

```bash
bunx tsc --noEmit
bunx vitest run src/ui/app/components/PtyTerminal.test.tsx tests/unit/ui/agent-hub/pty-terminal.layout-recovery.test.tsx tests/unit/ui/agent-hub/agents-page.issue806.test.tsx tests/unit/ui/agent-hub/agents-page.tiled-workbench.issue842.test.tsx tests/unit/ui/agent-hub/pty-prompt-composer.test.tsx tests/unit/ui/agent-hub/pty-session-recovery.test.ts tests/unit/ui/agent-hub/session-card.stop.test.tsx
cargo test -p exomind-runtime routes::pty::tests --lib
cargo test -p exomind-runtime --test pty_agent
```

Additional plan-style residual scans were also run and returned no PTY-legacy hits for the targeted patterns:

```bash
git grep -n "/pty/:id/stream\\|/pty/:id/input" -- crates/exomind-runtime/src src tests docs ":(exclude)docs/plans/**"
git grep -n "text/event-stream\\|parseSseFrame\\|EventSource\\|/stream" -- src tests docs ":(exclude)docs/plans/**"
git grep -n "sendPtyTextInput\\|/pty/.*/input\\|fetch(.*pty.*input" -- src tests docs ":(exclude)docs/plans/**"
git grep -n "sse_http\\|hybrid_ws_input\\|fallback" -- src crates tests docs ":(exclude)docs/plans/**"
```

## Runtime/Tauri Evidence

### Active desktop runtime

- Tauri MCP confirmed the app was connected on `localhost:9255`.
- Runtime status was read from the running app and matched the window title ports:
  - Web `1452`
  - Runtime `1967`
  - Host id `rt-38b0b3e5-792b-4cd1-863e-2250eba9ed5b`

### Active PTY sessions

`fetch('http://127.0.0.1:1967/sessions')` returned the current active PTY sessions including:

- `15241557-3a6a-4e0a-a699-0b5db9b895bf` (`issue897-s3-claude-r2`)
- `e6f19eae-8365-4b35-8e6a-66e84389a5f5` (`issue897-s3-codex`)
- `63ec0834-7c63-4f18-a7f7-697bafc8a08f` (`issue897-s3-claude-docs`)

### Legacy PTY endpoint runtime probes

For the live PTY `15241557-3a6a-4e0a-a699-0b5db9b895bf`, direct runtime probes returned:

- `POST /pty/15241557-3a6a-4e0a-a699-0b5db9b895bf/input` => `404`
- `GET /pty/15241557-3a6a-4e0a-a699-0b5db9b895bf/stream` => `404`

This was collected from the running Tauri app via webview-side `fetch`.

### Console log evidence

The desktop console logs show PTY transport activity using only WebSocket URLs:

- input:
  - `ws://127.0.0.1:1967/pty/<id>/ws?mode=input`
- output:
  - `ws://127.0.0.1:1967/pty/<id>/ws?mode=output`

Observed PTY ids in logs include:

- `15241557-3a6a-4e0a-a699-0b5db9b895bf`
- `e6f19eae-8365-4b35-8e6a-66e84389a5f5`
- `63ec0834-7c63-4f18-a7f7-697bafc8a08f`

No PTY log evidence was observed for `/pty/:id/input` or `/pty/:id/stream`.

### Tiled-page state snapshot

At capture time, the Tauri accessibility snapshot showed:

- current page = `网络 / 平铺`
- `未分配 0`
- three visible PTY panes:
  - `issue897-s3-claude-r2`
  - `issue897-s3-codex`
  - `issue897-s3-claude-docs`

This confirms the tiled surface had all three PTY sessions bound at the time of verification.

## Transcript Evidence

The live runtime transcript directory for the current desktop instance is:

`H:\A137442\Develop\AGI\exomind\.tmp\tauri-dev-state\issue897-s3e\app-data\runtime\pty-transcripts`

Observed transcript evidence:

- Claude r2 transcript contains repeated successful token output:
  - `S3-CLAUDE-R2-ALIVE`
- Codex transcript contains the prompt:
  - `Reply with exactly S3-CODEX-ALIVE and nothing else.`
- Current active transcript files:
  - `15241557-3a6a-4e0a-a699-0b5db9b895bf.log`
  - `e6f19eae-8365-4b35-8e6a-66e84389a5f5.log`
  - `63ec0834-7c63-4f18-a7f7-697bafc8a08f.log`

## What This Evidence Supports

This evidence supports the following statements:

1. The current codebase has removed the legacy PTY `/input` and `/stream` routes from runtime routing.
2. The current frontend PTY input/output path is WebSocket-based.
3. The live desktop instance is actively using PTY WebSocket input/output for current sessions.
4. The removed legacy PTY endpoints return `404` against the live embedded runtime.

## Remaining Gap Against the Strict Plan DoD

The current evidence does **not** fully satisfy the strict wording of `DoD-S3` in the plan document yet.

Specifically missing from this turn:

1. A documented `完整验证窗口` covering `72` hours across `3` natural days.
2. A formal archived proof set for:
   - `runtime route access logs + frontend transport telemetry`
   - zero natural business hits to legacy PTY endpoints during that window
3. A fully archived Tauri MCP runbook result set for all required user narratives after legacy endpoint deletion.

## Current Status

- Implementation status: `S3 implementation appears complete`
- Runtime probe status: `legacy PTY input/stream endpoints removed and returning 404`
- Candidate push status: `ready for scoped commit/push and human validation`
- Strict plan-DoD status: `not yet closed as PASS from this evidence alone`

This distinction is intentional and should be preserved in downstream review.
