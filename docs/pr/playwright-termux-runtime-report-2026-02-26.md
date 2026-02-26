# Playwright E2E Runtime Report (2026-02-26)

## Scope

- Unified E2E runtime dispatcher landed:
  - `Scripts/test/playwright-runner.cjs`
  - `Scripts/test/runtime-dispatch.cjs`
- `package.json` all `test:e2e*` scripts now route through the dispatcher.
- All Playwright E2E configs now use dispatcher-backed `webServer.command`.
- Default browser channel lock (`channel: 'chrome'`) removed.

## Environment

- Branch: `dev`
- Runtime on this device:
  - `bun`: not found
  - `node`: `v25.3.0`
  - `npm`: `11.10.0`
- Platform: Termux / Android

## Validation Commands and Results

1) Playwright E2E entry checks

- `npm run test:e2e:issue77`
- `npm run test:e2e:issue82`
- `npm run test:e2e:issue27`

Result:

- All three commands entered unified dispatcher and selected `runtime=node`.
- All three failed at Playwright bootstrap with:
  - `Error: Unsupported platform: android`

2) Dispatcher fallback behavior checks

- `EXOMIND_JS_RUNTIME=bun node Scripts/test/runtime-dispatch.cjs vite-dev`
  - Result: expected fail fast (`bun` not in PATH).

- `node server/pouchdb-server.js`
  - Result: fails in this Termux/Android Node environment with upstream ESM loader error:
    - `ERR_UNKNOWN_FILE_EXTENSION ... .l2s.index.js0074.0002`
  - Meaning: issue27 node fallback cannot be fully validated on this device due environment/runtime compatibility limits.

- `timeout 90s node Scripts/test/runtime-dispatch.cjs issue77-preview 1436`
  - Result: node fallback path executed `tsc + vite build + vite preview` successfully to preview URL before timeout.
  - This confirms issue-77 critical path is no longer tied to `npx tsc`.

- `timeout 30s node Scripts/test/runtime-dispatch.cjs vite-dev`
  - Result: node fallback path started Vite dev server (port conflict warning observed for HMR port already in use).

## Key Conclusion

- Runtime unification and Bun→Node fallback are working as designed.
- Current blocker for full E2E pass on this device is upstream Playwright platform support (`android` unsupported in this Node environment), not the project scripts/config.

## Request

@hailaylin 请在电脑端（Linux/macOS/Windows）拉最新代码后复测以下命令并反馈结果：

- `npm run test:e2e:issue77`
- `npm run test:e2e:issue82`
- `npm run test:e2e:issue27`

重点确认：

- `issue77` 不再出现 `This is not the tsc command you are looking for`。
- 默认可用 Chromium 路径可正常拉起并执行。
