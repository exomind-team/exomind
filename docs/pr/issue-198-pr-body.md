## Summary

Implement responsive desktop shell and desktopized settings page for Issue #198.

- Add `DesktopLayout（桌面布局）` and `DesktopSidebar（桌面侧栏）` in new UI route shell.
- Enable desktop layout only for `/settings` on `>= md` breakpoint.
- Keep existing mobile shell + bottom tab bar behavior for all mobile paths.
- Add unit and Playwright coverage for desktop/mobile behavior.

## Why

Pencil has a complete desktop settings design, while other desktop pages are still not ready.
This PR follows a staged rollout: land routing and shell foundation first, with settings page as the initial desktopized page.

## Scope

- In scope:
  - Responsive shell switch logic
  - Desktop sidebar/navigation shell
  - Settings desktop layout behavior
  - Unit + E2E tests
- Out of scope:
  - Desktop content redesign for Dashboard/EventLog/Focus

## Validation

Planned verification commands:

```bash
bunx vitest run tests/unit/ui/new-desktop-settings-shell.issue198.test.ts
bun run test:e2e:issue198
bun run build
```

## Notes

- This PR is intentionally incremental.
- Issue comment synchronization will be posted after PR implementation is near completion.
