# Playwright E2E Runtime Guide

## Goal

This project uses a unified E2E runtime dispatcher:

- Prefer Bun when Bun is available.
- Fallback to Node only when Bun is not available.
- Use Playwright bundled Chromium by default (no system Chrome required).

## Quick Start (PC, fresh clone)

1. Install dependencies:
   - `npm install`
2. Install Playwright browsers:
   - `npx playwright install`
3. Run a target E2E case:
   - `npm run test:e2e:issue77`
   - `npm run test:e2e:issue82`
   - `npm run test:e2e:issue27`

## Runtime Behavior

- Unified E2E entry: `Scripts/test/playwright-runner.cjs`
- Unified runtime dispatcher: `Scripts/test/runtime-dispatch.cjs`
- Runtime selection env var:
  - `EXOMIND_JS_RUNTIME=auto` (default)
  - `EXOMIND_JS_RUNTIME=bun`
  - `EXOMIND_JS_RUNTIME=node`

`auto` means:

- If `bun` is in `PATH`, Bun path is used.
- If `bun` is missing, Node path is used.

## Termux Notes

Recommended baseline:

1. Install Node.js + npm.
2. Install Bun (optional but preferred).
3. Install project deps (`npm install` or `bun install`).
4. Install Playwright browsers/deps as supported by your Termux environment.

Run with explicit Node fallback if needed:

- `EXOMIND_JS_RUNTIME=node npm run test:e2e:issue82`

If GUI/browser runtime is constrained on device, run smoke checks in Termux and run full browser validation on desktop.

## Troubleshooting

- Bun not found:
  - Expected behavior in `auto`: dispatcher falls back to Node.
- Browser not found:
  - Run `npx playwright install`.
- Port conflict:
  - Use issue-specific Playwright configs under `tests/e2e/playwright.issue*.config.ts` which already isolate ports.
