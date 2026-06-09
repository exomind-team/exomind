# Playwright E2E Runtime Guide

## Goal

This project uses a unified E2E runtime dispatcher:

- Prefer Bun when Bun is available.
- Fallback to Node only when Bun is not available.
- Use Playwright bundled Chromium by default (no system Chrome required).

## Quick Start (PC, fresh clone)

1. Install dependencies:
   - `bun install`
2. Install Playwright browsers:
   - `bun x playwright install`
3. Run a target E2E case:
   - `bun run test:e2e:issue77`
   - `bun run test:e2e:issue82`
   - `bun run test:e2e:issue27`

## Runtime Behavior

- Unified E2E entry: `scripts/test/playwright-runner.cjs`
- Unified runtime dispatcher: `scripts/test/runtime-dispatch.cjs`
- Runtime selection env var:
  - `EXOMIND_JS_RUNTIME=auto` (default)
  - `EXOMIND_JS_RUNTIME=bun`
  - `EXOMIND_JS_RUNTIME=node`

`auto` means:

- If `bun` is in `PATH`, Bun path is used.
- If `bun` is missing, Node path is used.

## Termux Notes

Recommended baseline:

1. Install Node.js.
2. Install Bun.
3. Install project deps (`bun install`).
4. Install Playwright browsers/deps as supported by your Termux environment.

Run with explicit Node fallback if needed:

- `EXOMIND_JS_RUNTIME=node bun run test:e2e:issue82`

If GUI/browser runtime is constrained on device, run smoke checks in Termux and run full browser validation on desktop.

## Troubleshooting

- Bun not found:
  - Expected behavior in `auto`: dispatcher falls back to Node.
- Browser not found:
- Run `bun x playwright install`.
- Port conflict:
  - Use issue-specific Playwright configs under `tests/e2e/playwright.issue*.config.ts` which already isolate ports.
