# TimeBlock 统一数据结构 Step 1 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 ActiveBlockData + TimeBlockData 统一为一个 TimeBlock 结构，用 transitions 数组替代 12 个运行时字段。

**Architecture:** 渐进式迁移——先添加 transitions + derive 函数（不破坏现有代码），再让 service 层双写（transitions + 旧字段），最后迁移消费者并删除旧字段。

**Tech Stack:** TypeScript, Vitest, Rust, axum, SQLite

---

## 影响面数据

- **TS 旧字段消费点**: 337 处，43 个文件
- **热点文件**: timeblock.service.ts (108), active-block-storage.ts (20), countdown-progress.ts (17)
- **saveActiveBlock 调用点**: 9 处
- **Rust ActiveBlockData**: 25 字段
- **Rust TimeBlockData**: 13 字段
- **需新增 Rust 路由**: 4 个 (stop/pause/resume/describe-no-id)

## 分阶段策略

```
Phase A: 基础层（纯添加，不破坏）     ← 可并行
Phase B: Service 层双写              ← 核心改动
Phase C: Rust 新路由                  ← 可并行
Phase D: 消费者迁移 + 清理            ← 后续 issue
```

---

## Phase A: 基础层（纯添加）

### Task 1: 定义 BlockTransition 类型

**Files:**
- Modify: `src/lib/types/event.ts`

**Step 1: 在 event.ts 中 BlockType 定义之后添加 BlockTransition**

```typescript
export type BlockTransitionType = 'start' | 'pause' | 'resume' | 'feedback_start' | 'feedback_submit' | 'end';

export interface BlockTransition {
  type: BlockTransitionType;
  at: Timestamp;
  actorId?: string;
}
```

**Step 2: 给 TimeBlockData 和 ActiveBlockData 添加可选 transitions 字段**

```typescript
// 在 TimeBlockData 中添加
transitions?: BlockTransition[];

// 在 ActiveBlockData 中添加
transitions?: BlockTransition[];
```

**Step 3: 运行 tsc 确认无错误**

Run: `npx tsc --noEmit`
Expected: 零错误

**Step 4: Commit**

```bash
git add src/lib/types/event.ts
git commit -m "feat(timeblock): add BlockTransition type and transitions field for #780"
```

---

### Task 2: 实现 derive 函数（RED）

**Files:**
- Create: `src/lib/timeblock/derive.ts`
- Create: `tests/unit/timeblock/derive.issue780.test.ts`

**Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import type { BlockTransition } from '@/lib/types/event';
import {
  derivePhase,
  deriveIsPaused,
  deriveStartTime,
  deriveEndTime,
  deriveAccumulatedRunMs,
  derivePauseAccumulatedMs,
  deriveLastResumedAt,
} from '@/lib/timeblock/derive';

describe('#780 derive functions', () => {
  const T = (type: string, at: number): BlockTransition => ({ type: type as any, at });

  describe('derivePhase', () => {
    it('returns running for [start]', () => {
      expect(derivePhase([T('start', 1000)])).toBe('running');
    });
    it('returns paused for [start, pause]', () => {
      expect(derivePhase([T('start', 1000), T('pause', 2000)])).toBe('paused');
    });
    it('returns running for [start, pause, resume]', () => {
      expect(derivePhase([T('start', 1000), T('pause', 2000), T('resume', 3000)])).toBe('running');
    });
    it('returns feedback for [start, feedback_start]', () => {
      expect(derivePhase([T('start', 1000), T('feedback_start', 5000)])).toBe('feedback');
    });
    it('returns completed for [..., feedback_submit, end]', () => {
      expect(derivePhase([T('start', 1000), T('feedback_start', 5000), T('feedback_submit', 6000), T('end', 6000)])).toBe('completed');
    });
    it('returns idle for empty transitions', () => {
      expect(derivePhase([])).toBe('idle');
    });
  });

  describe('deriveIsPaused', () => {
    it('false for [start]', () => {
      expect(deriveIsPaused([T('start', 1000)])).toBe(false);
    });
    it('true for [start, pause]', () => {
      expect(deriveIsPaused([T('start', 1000), T('pause', 2000)])).toBe(true);
    });
    it('false for [start, pause, resume]', () => {
      expect(deriveIsPaused([T('start', 1000), T('pause', 2000), T('resume', 3000)])).toBe(false);
    });
  });

  describe('deriveStartTime / deriveEndTime', () => {
    it('startTime = transitions[0].at', () => {
      expect(deriveStartTime([T('start', 1000)])).toBe(1000);
    });
    it('startTime undefined for empty', () => {
      expect(deriveStartTime([])).toBeUndefined();
    });
    it('endTime = last end transition at', () => {
      expect(deriveEndTime([T('start', 1000), T('end', 5000)])).toBe(5000);
    });
    it('endTime undefined if no end', () => {
      expect(deriveEndTime([T('start', 1000)])).toBeUndefined();
    });
  });

  describe('deriveAccumulatedRunMs', () => {
    it('simple: start to now', () => {
      expect(deriveAccumulatedRunMs([T('start', 1000)], 5000)).toBe(4000);
    });
    it('with pause: start→pause→resume→now', () => {
      const tr = [T('start', 1000), T('pause', 3000), T('resume', 5000)];
      expect(deriveAccumulatedRunMs(tr, 7000)).toBe(4000); // (3000-1000) + (7000-5000)
    });
    it('currently paused: excludes current pause', () => {
      const tr = [T('start', 1000), T('pause', 3000)];
      expect(deriveAccumulatedRunMs(tr, 7000)).toBe(2000); // only 3000-1000
    });
    it('with feedback_start: stops counting', () => {
      const tr = [T('start', 1000), T('feedback_start', 5000)];
      expect(deriveAccumulatedRunMs(tr, 9000)).toBe(4000); // 5000-1000, feedback time excluded
    });
  });

  describe('derivePauseAccumulatedMs', () => {
    it('no pause = 0', () => {
      expect(derivePauseAccumulatedMs([T('start', 1000)], 5000)).toBe(0);
    });
    it('pause→resume = pause duration', () => {
      const tr = [T('start', 1000), T('pause', 3000), T('resume', 5000)];
      expect(derivePauseAccumulatedMs(tr, 7000)).toBe(2000);
    });
    it('currently paused: includes ongoing pause', () => {
      const tr = [T('start', 1000), T('pause', 3000)];
      expect(derivePauseAccumulatedMs(tr, 7000)).toBe(4000);
    });
  });

  describe('deriveLastResumedAt', () => {
    it('returns start time if never paused', () => {
      expect(deriveLastResumedAt([T('start', 1000)])).toBe(1000);
    });
    it('returns resume time after pause', () => {
      expect(deriveLastResumedAt([T('start', 1000), T('pause', 2000), T('resume', 3000)])).toBe(3000);
    });
  });
});
```

**Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/unit/timeblock/derive.issue780.test.ts`
Expected: FAIL (module not found)

---

### Task 3: 实现 derive 函数（GREEN）

**Files:**
- Create: `src/lib/timeblock/derive.ts`

**Step 1: 实现全部 7 个函数**

```typescript
import type { BlockTransition } from '@/lib/types/event';

export function derivePhase(transitions: BlockTransition[]): 'running' | 'paused' | 'feedback' | 'completed' | 'idle' {
  if (transitions.length === 0) return 'idle';
  const last = transitions[transitions.length - 1];
  switch (last.type) {
    case 'start': case 'resume': return 'running';
    case 'pause': return 'paused';
    case 'feedback_start': return 'feedback';
    case 'feedback_submit': case 'end': return 'completed';
    default: return 'idle';
  }
}

export function deriveIsPaused(transitions: BlockTransition[]): boolean {
  return derivePhase(transitions) === 'paused';
}

export function deriveStartTime(transitions: BlockTransition[]): number | undefined {
  return transitions.length > 0 ? transitions[0].at : undefined;
}

export function deriveEndTime(transitions: BlockTransition[]): number | undefined {
  for (let i = transitions.length - 1; i >= 0; i--) {
    if (transitions[i].type === 'end') return transitions[i].at;
  }
  return undefined;
}

export function deriveAccumulatedRunMs(transitions: BlockTransition[], now: number = Date.now()): number {
  let total = 0;
  let runStart: number | undefined;
  for (const t of transitions) {
    if (t.type === 'start' || t.type === 'resume') {
      runStart = t.at;
    } else if ((t.type === 'pause' || t.type === 'feedback_start' || t.type === 'end') && runStart !== undefined) {
      total += t.at - runStart;
      runStart = undefined;
    }
  }
  if (runStart !== undefined) total += now - runStart;
  return total;
}

export function derivePauseAccumulatedMs(transitions: BlockTransition[], now: number = Date.now()): number {
  let total = 0;
  let pauseStart: number | undefined;
  for (const t of transitions) {
    if (t.type === 'pause') {
      pauseStart = t.at;
    } else if ((t.type === 'resume') && pauseStart !== undefined) {
      total += t.at - pauseStart;
      pauseStart = undefined;
    }
  }
  if (pauseStart !== undefined) total += now - pauseStart;
  return total;
}

export function deriveLastResumedAt(transitions: BlockTransition[]): number | undefined {
  for (let i = transitions.length - 1; i >= 0; i--) {
    if (transitions[i].type === 'resume' || transitions[i].type === 'start') return transitions[i].at;
  }
  return undefined;
}
```

**Step 2: 运行测试确认 GREEN**

Run: `npx vitest run tests/unit/timeblock/derive.issue780.test.ts`
Expected: ALL PASS

**Step 3: tsc 检查**

Run: `npx tsc --noEmit`
Expected: 零错误

**Step 4: Commit**

```bash
git add src/lib/timeblock/derive.ts tests/unit/timeblock/derive.issue780.test.ts
git commit -m "feat(timeblock): implement derive functions from transitions for #780"
```

---

## Phase B: Service 层双写

### Task 4: Service 方法开始写 transitions

**Files:**
- Modify: `src/lib/services/timeblock.service.ts`

**目标**: 在 startBlock / pauseBlock / resumeBlock / markEnding / endBlock 中，创建/修改 ActiveBlockData 时同时写入 transitions 数组。旧字段保持不变（双写）。

**Step 1: startBlock 中初始化 transitions**

在 `startBlock()` 创建 activeBlock 时（约 line 284），添加：
```typescript
const activeBlock: ActiveBlockData = {
  // ... 现有字段 ...
  transitions: [{ type: 'start', at: now }],
};
```

**Step 2: pauseBlock 中 push pause transition**

在 `pauseBlock()` 更新 block 时（约 line 340），在设置 paused=true 后添加：
```typescript
const transitions = [...(activeData.transitions ?? []), { type: 'pause' as const, at: now }];
// 传给 saveActiveBlock 时包含 transitions
```

**Step 3: resumeBlock 中 push resume transition**

在 `resumeBlock()` 更新 block 时（约 line 380），在设置 paused=false 后添加：
```typescript
const transitions = [...(activeData.transitions ?? []), { type: 'resume' as const, at: now }];
```

**Step 4: markEnding 中 push feedback_start transition**

在 `markEnding()` 设置 actionEndedAt 时（约 line 440），添加：
```typescript
const transitions = [...(activeData.transitions ?? []), { type: 'feedback_start' as const, at: now }];
```

**Step 5: endBlock 中 push feedback_submit + end transitions**

在 `endBlock()` 创建完成块和 gap 块时（约 line 560），添加：
```typescript
// feedback_submit transition
const completedTransitions = [...(activeData.transitions ?? []), { type: 'feedback_submit' as const, at: submittedAt }];

// 在 timeBlock (TimeBlockData) 中保存 transitions
const timeBlock: TimeBlockData = {
  // ... 现有字段 ...
  transitions: [...completedTransitions, { type: 'end' as const, at: submittedAt }],
};

// gap 块的 transitions
const gapBlock: ActiveBlockData = {
  // ... 现有字段 ...
  transitions: [{ type: 'start' as const, at: submittedAt }],
};
```

**Step 6: 运行所有 #759 + #780 测试**

Run: `npx vitest run tests/unit/services/new-block.issue759.test.ts tests/unit/services/gap-backfill.issue759.test.ts tests/unit/timeblock/derive.issue780.test.ts`
Expected: ALL PASS

**Step 7: tsc 检查**

Run: `npx tsc --noEmit`

**Step 8: Commit**

```bash
git add src/lib/services/timeblock.service.ts
git commit -m "feat(timeblock): dual-write transitions in service methods for #780"
```

---

## Phase C: Rust 新路由

### Task 5: POST /timeblocks/stop 路由

**Files:**
- Modify: `crates/exomind-runtime/src/routes/timeblocks.rs`

**Step 1: 添加 StopBlockRequest + stop_block handler**

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StopBlockRequest {
    // 可选的附加信息
}

/// POST /timeblocks/stop — 结束专注，进入反馈阶段
/// Guard: must be active AND running (not feedback phase, not paused)
async fn stop_block(
    State(state): State<AppState>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let scope_key = query.profile_id.as_deref().or(query.user_id.as_deref());
    let current = state.timeblock_store
        .get_active_scoped(scope_key)
        .map_err(|e| internal_error(e.to_string()))?
        .ok_or_else(|| conflict("no active block"))?;

    if current.block_type.as_deref() == Some("gap") {
        return Err(conflict("cannot stop: current block is a gap"));
    }
    if current.feedback_submitted_at.is_some() {
        return Err(conflict("cannot stop: already in feedback phase"));
    }

    // TODO: 在 #780 transitions 实现后，push feedback_start transition
    // 当前先用旧字段实现
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    let mut updated = current;
    updated.action_ended_at = Some(now);
    updated.feedback_started_at = Some(now);
    updated.phase = Some("feedback_in_progress".to_string());
    // 递增 version
    updated.version = Some(updated.version.unwrap_or(0) + 1);
    updated.last_transition_at = Some(now);

    state.timeblock_store
        .put_active_scoped(scope_key, updated.clone())
        .map_err(|e| internal_error(e.to_string()))?;

    Ok(Json(serde_json::json!({ "status": "stopped", "phase": "feedback_in_progress" })))
}
```

**Step 2: 注册路由**

```rust
.route("/timeblocks/stop", post(stop_block))
```

**Step 3: cargo check**

Run: `cargo check -p exomind-runtime`

**Step 4: Commit**

### Task 6: POST /timeblocks/pause + /resume 路由

类似 Task 5，实现两个路由 + 守卫。

### Task 7: POST /timeblocks/describe（无 id，操作当前块）

类似现有 /:id/describe，但自动查找当前活跃块。

---

## Phase D: 消费者迁移（后续 issue 跟踪）

不在本次实施范围。337 个消费点按文件逐步迁移：
1. timeblock.service.ts (108 点) — 优先
2. active-block-storage.ts (20 点)
3. countdown-progress.ts (17 点)
4. UI 组件（逐个）

---

## 验收标准

- [ ] BlockTransition 类型定义存在（6 种类型）
- [ ] 7 个 derive 函数通过测试
- [ ] Service 方法双写 transitions
- [ ] Rust stop/pause/resume/describe 路由存在
- [ ] tsc 零错误 + vitest 全绿
- [ ] 现有功能无回归
