# Ritual Home（仪式首页）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a main-app Ritual Home（仪式首页） that owns morning boot / daily orientation / shutdown flows, while keeping the existing now overlay focused on execution-time continuity and lightweight nudges.

**Architecture:** Add a new `ritual home` page model above the current `/` route, keep `NowPage` as the daytime execution hub, and extend the overlay model with reminder-oriented states instead of turning it into a second full homepage. Persist one lightweight daily session record so the app knows whether the user is pre-boot, oriented, running, or ready to shut down.

**Tech Stack:** React 18, TanStack Router, Zustand/local state, Vitest, existing TimeBlock/EventLog/Overlay services, optional LLM-backed recommendation adapter with local fallback.

---

### Task 1: Introduce daily ritual session model（每日仪式会话模型）

**Files:**
- Create: `src/ui/app/ritual/ritual-session.ts`
- Create: `tests/unit/ui/ritual-session.test.ts`
- Modify: `src/ui/app/pages/FocusPage.tsx`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyRitualSession, resolveRitualStage } from '@/ui/app/ritual/ritual-session';

describe('ritual session', () => {
  it('starts in pre_boot for a new day', () => {
    const session = createEmptyRitualSession('2026-03-19');
    expect(resolveRitualStage(session)).toBe('pre_boot');
  });

  it('moves to shutdown_ready after the main task is done and no block is active', () => {
    const session = {
      dayKey: '2026-03-19',
      bootedAt: 1,
      selectedPlanId: 'plan-1',
      shutdownCompletedAt: null,
      mainTaskCompletedAt: 2,
    };
    expect(resolveRitualStage(session, { hasActiveBlock: false, isEvening: true })).toBe('shutdown_ready');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/ritual-session.test.ts`
Expected: FAIL because `ritual-session.ts` does not exist yet.

**Step 3: Write minimal implementation**

```ts
export type RitualStage = 'pre_boot' | 'intent_setup' | 'day_hub' | 'shutdown_ready' | 'shutdown_done';

export interface RitualSession {
  dayKey: string;
  bootedAt: number | null;
  selectedPlanId: string | null;
  mainTaskCompletedAt?: number | null;
  shutdownCompletedAt: number | null;
}

export function createEmptyRitualSession(dayKey: string): RitualSession {
  return {
    dayKey,
    bootedAt: null,
    selectedPlanId: null,
    mainTaskCompletedAt: null,
    shutdownCompletedAt: null,
  };
}

export function resolveRitualStage(
  session: RitualSession,
  input: { hasActiveBlock?: boolean; isEvening?: boolean } = {},
): RitualStage {
  if (session.shutdownCompletedAt) return 'shutdown_done';
  if (!session.bootedAt) return 'pre_boot';
  if (!session.selectedPlanId) return 'intent_setup';
  if (session.mainTaskCompletedAt && !input.hasActiveBlock && input.isEvening) return 'shutdown_ready';
  return 'day_hub';
}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/ritual-session.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/ritual/ritual-session.ts tests/unit/ui/ritual-session.test.ts
git commit -m "feat: add ritual session stage model"
```

---

### Task 2: Replace `/` with Ritual Home shell（用仪式首页壳替换根路由）

**Files:**
- Create: `src/ui/app/pages/RitualHomePage.tsx`
- Create: `tests/unit/pages/ritual-home-page.test.tsx`
- Modify: `src/ui/app/pages/FocusPage.tsx`
- Modify: `src/routes.tsx`
- Modify: `tests/home-page.test.ts`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RitualHomePage } from '@/ui/app/pages/RitualHomePage';

describe('RitualHomePage', () => {
  it('shows boot card in pre_boot stage', () => {
    render(<RitualHomePage stage="pre_boot" />);
    expect(screen.getByText('开始今天')).toBeInTheDocument();
    expect(screen.getByText('昨天停在哪')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/pages/ritual-home-page.test.tsx tests/home-page.test.ts`
Expected: FAIL because `RitualHomePage` does not exist and `/` still points straight to the old focus page shell.

**Step 3: Write minimal implementation**

```tsx
type RitualHomePageProps = {
  stage?: 'pre_boot' | 'intent_setup' | 'day_hub' | 'shutdown_ready' | 'shutdown_done';
};

export function RitualHomePage({ stage = 'pre_boot' }: RitualHomePageProps) {
  if (stage === 'pre_boot') {
    return (
      <main>
        <section>
          <h1>开始今天</h1>
          <p>先看状态，再定今天主线。</p>
        </section>
        <section>
          <h2>昨天停在哪</h2>
        </section>
      </main>
    );
  }

  return <FocusPage />;
}
```

Then route `/` to `RitualHomePage`, while keeping `/eventlog` mapped to the current `NowPage`.

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/pages/ritual-home-page.test.tsx tests/home-page.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/RitualHomePage.tsx src/ui/app/pages/FocusPage.tsx src/routes.tsx tests/unit/pages/ritual-home-page.test.tsx tests/home-page.test.ts
git commit -m "feat: add ritual home shell for root route"
```

---

### Task 3: Add morning recommendation cards（加入晨间推荐主线卡）

**Files:**
- Create: `src/ui/app/ritual/ritual-recommendation.ts`
- Create: `tests/unit/ui/ritual-recommendation.test.ts`
- Modify: `src/ui/app/pages/RitualHomePage.tsx`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildMorningPlanCandidates } from '@/ui/app/ritual/ritual-recommendation';

describe('buildMorningPlanCandidates', () => {
  it('returns at most 3 focused candidates', () => {
    const plans = buildMorningPlanCandidates({
      carryOverTask: '完成仪式首页设计',
      blockers: ['状态提醒规则未定'],
      fixedPoints: ['20:30 收工'],
      energy: 'medium',
    });
    expect(plans.length).toBeLessThanOrEqual(3);
    expect(plans[0]).toMatchObject({
      title: expect.any(String),
      targetOutcome: expect.any(String),
      suggestedWindows: expect.any(Array),
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/ritual-recommendation.test.ts`
Expected: FAIL because recommendation builder does not exist yet.

**Step 3: Write minimal implementation**

```ts
export interface MorningPlanCandidate {
  id: string;
  title: string;
  targetOutcome: string;
  suggestedWindows: string[];
}

export function buildMorningPlanCandidates(input: {
  carryOverTask?: string | null;
  blockers?: string[];
  fixedPoints?: string[];
  energy?: 'low' | 'medium' | 'high';
}): MorningPlanCandidate[] {
  const base = input.carryOverTask?.trim() || '先推进最关键的一步';
  return [
    {
      id: 'carry-over',
      title: base,
      targetOutcome: '把今天主线往前推进一个可见结果',
      suggestedWindows: ['上午先开一段', ...(input.fixedPoints ?? []).slice(0, 1)],
    },
    {
      id: 'blocker-cleanup',
      title: '先清掉一个阻塞项',
      targetOutcome: (input.blockers?.[0] ?? '清掉当前最影响推进的阻塞'),
      suggestedWindows: ['下午补一段'],
    },
  ].slice(0, 3);
}
```

Render each candidate card in `RitualHomePage` with fields:

- `title`
- `targetOutcome`
- `suggestedWindows`
- `选择这条主线`

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/ritual-recommendation.test.ts tests/unit/pages/ritual-home-page.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/ritual/ritual-recommendation.ts src/ui/app/pages/RitualHomePage.tsx tests/unit/ui/ritual-recommendation.test.ts
git commit -m "feat: add morning ritual plan recommendations"
```

---

### Task 4: Extend overlay model with nudges（给悬浮窗加入提醒态）

**Files:**
- Modify: `src/ui/app/overlay/now-workbench-overlay-model.ts`
- Modify: `src/pages/NowWorkbenchOverlayPage.tsx`
- Create: `tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts`
- Modify: `tests/unit/ui/now-workbench-overlay-model.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildNowWorkbenchOverlayModel } from '@/ui/app/overlay/now-workbench-overlay-model';

describe('overlay ritual nudges', () => {
  it('shows shutdown nudge when the day is ready to close', () => {
    const model = buildNowWorkbenchOverlayModel({
      activeBlock: null,
      tasks: [],
      events: [],
      now: Date.UTC(2026, 2, 19, 21, 30, 0),
      ritual: { stage: 'shutdown_ready' },
    });
    expect(model.nudge?.kind).toBe('shutdown_ready');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/ui/now-workbench-overlay-model.test.ts tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts`
Expected: FAIL because overlay model has no ritual nudge field.

**Step 3: Write minimal implementation**

```ts
export interface NowWorkbenchOverlayNudge {
  kind: 'status_check' | 'shutdown_ready';
  title: string;
  body: string;
  ctaLabel: string;
}
```

Add optional `ritual?: { stage: string }` input to overlay model builder, and emit:

- `shutdown_ready` nudge when ritual stage is `shutdown_ready`
- `status_check` nudge later when a simple idle heuristic is added

Render a compact top card in `NowWorkbenchOverlayPage` above the running/idle content:

```tsx
{model.nudge ? (
  <section data-testid="now-overlay-ritual-nudge">
    <p>{model.nudge.title}</p>
    <p>{model.nudge.body}</p>
    <Button onClick={onReturnToMain}>{model.nudge.ctaLabel}</Button>
  </section>
) : null}
```

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/ui/now-workbench-overlay-model.test.ts tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/overlay/now-workbench-overlay-model.ts src/pages/NowWorkbenchOverlayPage.tsx tests/unit/ui/now-workbench-overlay-model.test.ts tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts
git commit -m "feat: add ritual nudges to now overlay"
```

---

### Task 5: Add shutdown page and end-of-day handoff（加入收工页与收束交接）

**Files:**
- Modify: `src/ui/app/pages/RitualHomePage.tsx`
- Create: `tests/unit/pages/ritual-home-shutdown.test.tsx`
- Modify: `src/lib/services/signal-handlers.ts`
- Modify: `src/ui/hooks/useSignalStream.ts`

**Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RitualHomePage } from '@/ui/app/pages/RitualHomePage';

describe('RitualHomePage shutdown', () => {
  it('renders shutdown summary when stage is shutdown_ready', () => {
    render(<RitualHomePage stage="shutdown_ready" />);
    expect(screen.getByText('收住今天')).toBeInTheDocument();
    expect(screen.getByText('明天第一步')).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/pages/ritual-home-shutdown.test.tsx`
Expected: FAIL because shutdown stage UI does not exist yet.

**Step 3: Write minimal implementation**

Add shutdown stage branch to `RitualHomePage`:

```tsx
if (stage === 'shutdown_ready') {
  return (
    <main>
      <section>
        <h1>收住今天</h1>
        <p>今天完成了什么，卡在哪里，明天第一步是什么。</p>
      </section>
      <section>
        <h2>明天第一步</h2>
      </section>
      <button>正式收工</button>
    </main>
  );
}
```

Also wire `review.completed` signal payload into a small end-of-day summary adapter so the shutdown page can show:

- 有效
- 卡住
- 下次改
- 避免

without reading raw eventlog text in the page component.

**Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/pages/ritual-home-shutdown.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/app/pages/RitualHomePage.tsx src/lib/services/signal-handlers.ts src/ui/hooks/useSignalStream.ts tests/unit/pages/ritual-home-shutdown.test.tsx
git commit -m "feat: add ritual shutdown handoff"
```

---

### Task 6: Final verification and docs alignment（最终验证与文档对齐）

**Files:**
- Modify: `docs/product/PRD.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ARCH-signal-pool-agent-process.md`
- Test: `tests/home-page.test.ts`
- Test: `tests/unit/pages/ritual-home-page.test.tsx`
- Test: `tests/unit/pages/ritual-home-shutdown.test.tsx`
- Test: `tests/unit/ui/now-workbench-overlay-model.test.ts`
- Test: `tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts`

**Step 1: Write the failing doc/assertion checks**

If needed, add one small doc-level test or snapshot assertion that `/` now maps to `RitualHomePage` instead of plain `FocusPage`.

**Step 2: Run verification before doc updates**

Run:

```bash
bunx vitest run tests/home-page.test.ts tests/unit/pages/ritual-home-page.test.tsx tests/unit/pages/ritual-home-shutdown.test.tsx tests/unit/ui/now-workbench-overlay-model.test.ts tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts
```

Expected: PASS

**Step 3: Update product and architecture docs**

Document these decisions:

- main app owns morning boot and shutdown
- overlay owns execution continuity and lightweight nudges
- morning recommendation is suggestion, not automatic command

**Step 4: Run final verification**

Run:

```bash
bunx vitest run tests/home-page.test.ts tests/unit/pages/ritual-home-page.test.tsx tests/unit/pages/ritual-home-shutdown.test.tsx tests/unit/ui/now-workbench-overlay-model.test.ts tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts
bunx tsc --noEmit
```

Expected:

- all listed tests PASS
- `tsc` exits 0

**Step 5: Commit**

```bash
git add docs/product/PRD.md docs/architecture/overview.md docs/architecture/ARCH-signal-pool-agent-process.md tests/home-page.test.ts tests/unit/pages/ritual-home-page.test.tsx tests/unit/pages/ritual-home-shutdown.test.tsx tests/unit/ui/now-workbench-overlay-model.test.ts tests/unit/ui/now-workbench-overlay-ritual-nudges.test.ts
git commit -m "docs: align ritual home and overlay flow"
```

