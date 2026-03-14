# 统一日志接口 + LogPanel 新 UI 设计实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建立双写日志接口（调试面板 + console），将 LogPanel 迁移到新 UI 设计系统，逐步替换项目中的 console.* 调用。

**Architecture:** 改造 `src/lib/logger.ts` 为双写模式：每次调用 `log.info()` 等函数时，同时写入内存 listener（供 LogPanel 消费）和 `console.*`（供浏览器 DevTools 查看）。Tauri 环境额外通过 `@tauri-apps/plugin-log` 写入 Rust 统一日志文件。LogPanel UI 从 shadcn 旧 token 迁移到 ExoMind 暖石色系。

**Tech Stack:** TypeScript, React 18, Tailwind CSS（ExoMind 设计 token），Vitest

---

## Task 1: 改造 logger.ts — 双写日志接口

**Files:**
- Modify: `src/lib/logger.ts`
- Test: `src/lib/logger.test.ts`（新建）

**Step 1: 写失败测试**

创建 `src/lib/logger.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/plugin-log before import
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  attachLogger: vi.fn().mockResolvedValue(() => {}),
}));

import { log, addLogListener, type LogEntry } from '@/lib/logger';

describe('unified logger（统一日志双写）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('log.info writes to both console and listeners', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.info('hello world');

    expect(consoleSpy).toHaveBeenCalledWith('[INFO]', 'hello world');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('INFO');
    expect(entries[0].message).toBe('hello world');

    unsub();
    consoleSpy.mockRestore();
  });

  it('log.warn writes to console.warn and listeners', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.warn('warning msg');

    expect(consoleSpy).toHaveBeenCalledWith('[WARN]', 'warning msg');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('WARN');

    unsub();
    consoleSpy.mockRestore();
  });

  it('log.error writes to console.error and listeners', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.error('error msg');

    expect(consoleSpy).toHaveBeenCalledWith('[ERROR]', 'error msg');
    expect(entries[0].level).toBe('ERROR');

    unsub();
    consoleSpy.mockRestore();
  });

  it('log.debug writes to console.debug and listeners', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.debug('debug msg');

    expect(consoleSpy).toHaveBeenCalledWith('[DEBUG]', 'debug msg');
    expect(entries[0].level).toBe('DEBUG');

    unsub();
    consoleSpy.mockRestore();
  });

  it('listener unsubscribe stops receiving entries', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const entries: LogEntry[] = [];
    const unsub = addLogListener((entry) => entries.push(entry));

    log.info('before');
    unsub();
    log.info('after');

    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('before');
  });
});
```

**Step 2: 运行测试确认失败**

Run: `bunx vitest run src/lib/logger.test.ts`
Expected: FAIL — `log` 不存在

**Step 3: 实现双写 logger**

重写 `src/lib/logger.ts`：

```typescript
import {
  info as tauriInfo,
  warn as tauriWarn,
  error as tauriError,
  debug as tauriDebug,
  trace as tauriTrace,
  attachLogger,
} from '@tauri-apps/plugin-log';

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
}

export type LogListener = (entry: LogEntry) => void;

const LOG_LEVEL_MAP: Record<number, LogLevel> = {
  1: 'TRACE',
  2: 'DEBUG',
  3: 'INFO',
  4: 'WARN',
  5: 'ERROR',
};

const CONSOLE_METHOD: Record<LogLevel, keyof Console> = {
  TRACE: 'debug',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

let detachFn: (() => void) | null = null;
const listeners = new Set<LogListener>();

function emit(level: LogLevel, message: string): void {
  const entry: LogEntry = { level, message, timestamp: new Date() };

  // 1) Browser console
  const method = CONSOLE_METHOD[level];
  // eslint-disable-next-line no-console
  (console[method] as (...args: unknown[]) => void)(`[${level}]`, message);

  // 2) In-memory listeners (LogPanel)
  for (const listener of listeners) {
    listener(entry);
  }
}

/** 双写日志对象：同时输出到 console + LogPanel listeners */
export const log = {
  trace: (message: string) => { emit('TRACE', message); void tauriTrace(message).catch(() => {}); },
  debug: (message: string) => { emit('DEBUG', message); void tauriDebug(message).catch(() => {}); },
  info:  (message: string) => { emit('INFO',  message); void tauriInfo(message).catch(() => {}); },
  warn:  (message: string) => { emit('WARN',  message); void tauriWarn(message).catch(() => {}); },
  error: (message: string) => { emit('ERROR', message); void tauriError(message).catch(() => {}); },
};

export async function startLogStream(): Promise<() => void> {
  if (detachFn) return detachFn;

  detachFn = await attachLogger(({ level, message }) => {
    const entry: LogEntry = {
      level: LOG_LEVEL_MAP[level] ?? 'INFO',
      message,
      timestamp: new Date(),
    };
    for (const listener of listeners) {
      listener(entry);
    }
  });

  return detachFn;
}

export function stopLogStream(): void {
  if (detachFn) {
    detachFn();
    detachFn = null;
  }
}

export function addLogListener(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 向后兼容：保留旧的直接 re-export（逐步废弃）
export const info = log.info;
export const warn = log.warn;
export const error = log.error;
export const debug = log.debug;
export const trace = log.trace;
```

**Step 4: 运行测试确认通过**

Run: `bunx vitest run src/lib/logger.test.ts`
Expected: PASS（5 tests）

**Step 5: 提交**

```bash
git add src/lib/logger.ts src/lib/logger.test.ts
git commit -m "feat(log): 双写日志接口 — console + listener 同时输出"
```

---

## Task 2: LogPanel UI 迁移到新设计系统

**Files:**
- Modify: `src/ui/app/components/settings/LogPanel.tsx`
- Modify: `src/ui/app/config/settings/LogPanelDialog.tsx`
- Test: `src/ui/app/components/settings/__tests__/LogPanel.test.tsx`

**Step 1: 更新 LogPanel.tsx — 移除 shadcn Button，使用新 token**

将 `LogPanel.tsx` 替换为：

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { addLogListener, startLogStream, type LogEntry, type LogLevel } from '@/lib/logger'

const LEVELS: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const LEVEL_ORDER: Record<LogLevel, number> = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 }
const LEVEL_COLORS: Record<LogLevel, string> = {
  TRACE: 'text-[#A8A29E]',
  DEBUG: 'text-[#60A5FA]',
  INFO: 'text-[#34D399]',
  WARN: 'text-[#FBBF24]',
  ERROR: 'text-[#F87171]',
}
const MAX_ENTRIES = 500

function LevelFilterButton({
  level,
  active,
  onClick,
}: {
  level: LogLevel
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={level}
      aria-pressed={active}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-[#1C1917] text-[#FAFAF9] dark:bg-[#FAFAF9] dark:text-[#1C1917]'
          : 'text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]'
      }`}
    >
      {level.toLowerCase()}
    </button>
  )
}

export function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [minLevel, setMinLevel] = useState<LogLevel>('INFO')
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoScroll = useRef(true)

  useEffect(() => {
    startLogStream()
    const removeListener = addLogListener((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
      })
    })
    return () => {
      removeListener()
    }
  }, [])

  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  const filtered = entries.filter((e) => LEVEL_ORDER[e.level] >= LEVEL_ORDER[minLevel])

  return (
    <div className="flex flex-col h-[60vh] gap-3">
      <div className="flex items-center gap-1 flex-shrink-0">
        {LEVELS.map((level) => (
          <LevelFilterButton
            key={level}
            level={level}
            active={minLevel === level}
            onClick={() => setMinLevel(level)}
          />
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setEntries([])}
          aria-label="清除"
          className="rounded-lg px-3 py-1.5 text-xs text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524] transition-colors"
        >
          清除
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto font-mono text-xs rounded-xl border border-[#F0ECE8] bg-[#FAF7F5] p-3 space-y-0.5 dark:border-[#292524] dark:bg-[#0C0A09]"
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div className="text-[#A8A29E] text-center py-8">暂无日志</div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className="flex gap-2 leading-5">
              <span className="text-[#A8A29E] whitespace-nowrap">
                {entry.timestamp.toLocaleTimeString()}
              </span>
              <span className={`font-semibold w-12 text-right ${LEVEL_COLORS[entry.level]}`}>
                {entry.level}
              </span>
              <span className="text-[#1C1917] dark:text-[#FAFAF9] break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

**Step 2: 更新 LogPanelDialog.tsx — 使用新 token**

```tsx
import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LogPanel } from '@/ui/app/components/settings/LogPanel'

export function LogPanelDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-log-panel', handler)
    return () => window.removeEventListener('open-log-panel', handler)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl rounded-2xl border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
        <DialogHeader>
          <DialogTitle className="text-[#1C1917] dark:text-[#FAFAF9]">调试日志</DialogTitle>
        </DialogHeader>
        <LogPanel />
      </DialogContent>
    </Dialog>
  )
}
```

**Step 3: 更新 LogPanel 测试 — 适配新 UI**

修改 `src/ui/app/components/settings/__tests__/LogPanel.test.tsx`：
- 移除对 `Button` 的 mock（不再使用 shadcn Button）
- 更新查询方式：用 `getByRole('button', { name: 'info' })` 替代 shadcn Button 查询
- 验证新 class name 中包含新 token（如 `#FAF7F5`）

**Step 4: 运行测试确认通过**

Run: `bunx vitest run src/ui/app/components/settings/__tests__/LogPanel.test.tsx`
Expected: PASS

**Step 5: 提交**

```bash
git add src/ui/app/components/settings/LogPanel.tsx src/ui/app/config/settings/LogPanelDialog.tsx src/ui/app/components/settings/__tests__/LogPanel.test.tsx
git commit -m "style(log): LogPanel 迁移到新 UI 设计系统 — 暖石色系 + 移除 shadcn Button"
```

---

## Task 3: 迁移高频 console.* 文件到 log 接口（第一批：ASR 模块）

**Files:**
- Modify: `src/lib/adapters/asr/volcano-engine-asr.ts`（42 处）
- Modify: `src/lib/adapters/asr/moss-asr.ts`（29 处）
- Modify: `src/lib/adapters/asr/volcano-http-asr.ts`（14 处）

**Step 1: 批量替换 volcano-engine-asr.ts**

```
import { log } from '@/lib/logger'

// 替换规则：
// console.log('[TAG]', ...)   → log.info(...)
// console.warn('[TAG]', ...)  → log.warn(...)
// console.error('[TAG]', ...) → log.error(...)
// console.debug('[TAG]', ...) → log.debug(...)
```

注意：`console.log` 接受多参数（`console.log('a', obj)`），但 `log.info` 只接受 string。
需要用模板字符串或 JSON.stringify 合并参数。

对于带对象的日志：
```typescript
// Before:
console.log('[VolcanoASR] connection opened', { url, config });
// After:
log.info(`[VolcanoASR] connection opened ${JSON.stringify({ url, config })}`);
```

对于简单字符串：
```typescript
// Before:
console.log('[VolcanoASR] stream started');
// After:
log.info('[VolcanoASR] stream started');
```

**Step 2: 同样替换 moss-asr.ts 和 volcano-http-asr.ts**

**Step 3: 运行相关测试**

Run: `bunx vitest run --reporter=verbose 2>&1 | grep -E "asr|volcano|moss"`
Expected: 无新增失败

**Step 4: 提交**

```bash
git add src/lib/adapters/asr/
git commit -m "refactor(log): ASR 模块迁移到统一日志接口（85 处 console.* → log.*）"
```

---

## Task 4: 迁移第二批 — 核心服务模块

**Files:**
- Modify: `src/lib/sync/message-storage.ts`（21 处）
- Modify: `src/lib/services/voice-chat.service.ts`（21 处）
- Modify: `src/ui/app/components/FocusTimerWidget.tsx`（13 处）

**Step 1-3: 同 Task 3 的替换规则**

**Step 4: 运行测试**

Run: `bunx vitest run`
Expected: 无新增失败

**Step 5: 提交**

```bash
git add src/lib/sync/message-storage.ts src/lib/services/voice-chat.service.ts src/ui/app/components/FocusTimerWidget.tsx
git commit -m "refactor(log): 核心服务模块迁移到统一日志接口（55 处 console.* → log.*）"
```

---

## Task 5: 迁移第三批 — storage + 剩余文件

**Files:**
- Modify: `src/lib/storage/event-storage.ts`（4 处）
- Modify: `src/lib/storage/task-storage.ts`（4 处）
- Modify: `src/lib/storage/active-block-storage.ts`（4 处）
- Modify: `src/lib/storage/reminder-storage.ts`（4 处）
- Modify: 其余文件中的 `console.*` 调用

**替换规则同上。**

**提交：**
```bash
git commit -m "refactor(log): storage 及剩余模块迁移到统一日志接口"
```

---

## Task 6: 最终验证 + 清理

**Step 1: 全局检查遗留 console.* 调用**

```bash
grep -rn "console\.\(log\|info\|warn\|error\|debug\)" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\." | wc -l
```

目标：核心业务代码中 console.* 调用降至 0（测试文件和第三方适配器除外）。

**Step 2: 运行全量测试**

Run: `bunx vitest run`
Expected: 无新增失败

**Step 3: TypeScript 检查**

Run: `bunx tsc --noEmit`
Expected: 无新增错误

**Step 4: 提交**

```bash
git commit -m "chore(log): 统一日志迁移完成 — 全局 console.* 清理验证"
```

---

## 设计要点

### 新旧 Token 对照（LogPanel 使用）

| 用途 | 旧 (shadcn) | 新 (ExoMind) |
|------|-------------|-------------|
| 按钮选中态 | `Button variant="default"` | `bg-[#1C1917] text-[#FAFAF9]` |
| 按钮未选中 | `Button variant="outline"` | `text-[#78716C] hover:bg-[#F5F0ED]` |
| 日志区背景 | `bg-muted/50` | `bg-[#FAF7F5] dark:bg-[#0C0A09]` |
| 日志区边框 | `rounded-md` | `rounded-xl border-[#F0ECE8] dark:border-[#292524]` |
| 空状态文字 | `text-muted-foreground` | `text-[#A8A29E]` |
| 日志正文 | 无显式颜色 | `text-[#1C1917] dark:text-[#FAFAF9]` |
| Dialog 容器 | 默认 | `rounded-2xl border-[#F0ECE8] bg-white dark:border-[#292524] dark:bg-[#1C1917]` |

### log 对象 API

```typescript
import { log } from '@/lib/logger';

log.trace('详细追踪');   // → console.debug + listeners + tauri trace
log.debug('调试信息');   // → console.debug + listeners + tauri debug
log.info('普通信息');    // → console.info  + listeners + tauri info
log.warn('警告');       // → console.warn  + listeners + tauri warn
log.error('错误');      // → console.error + listeners + tauri error
```
