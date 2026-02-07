# Event Log LAN MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在双设备（电脑主机 + 手机客户端）局域网场景下，实现事件日志的本地存储、显示、同步，并通过 MCP 访问事件读写。

**Architecture:** 前端通过 Tauri IPC 调用事件日志命令；电脑端启动 WebSocket 服务器，手机端作为客户端连接并交换事件；事件落地为 JSONL + `event_log.md` 镜像；MCP 通过 mcp-server-tauri 的 `ipc_execute_command` 访问事件读写命令。

**Tech Stack:** Tauri 2, Rust (tokio/tungstenite), React 18, TypeScript, Zustand, Vitest.

---

## Pre-flight Notes
- 基线测试当前失败（`npm test -- --run`），涉及 `tests/p2p-ipc.test.ts` 和 `tests/components/chat-window.test.tsx` 的既有问题；执行计划时请保留失败记录，不在本次 MVP 中强行修复。

### Task 1: 设备标识与 Event ID 生成器

**Files:**
- Create: `src/lib/eventlog/event-id.ts`
- Create: `tests/unit/eventlog/event-id.test.ts`
- Modify: `src/lib/sync/sync-protocol.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/eventlog/event-id.test.ts
import { describe, it, expect } from 'vitest';
import { createEventId } from '@/lib/eventlog/event-id';

describe('event id generator', () => {
  it('should include device id and ms timestamp', () => {
    const id = createEventId('device-001', 1700000000000, 12);
    expect(id).toBe('device-001:1700000000000:12');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/eventlog/event-id.test.ts`
Expected: FAIL with "createEventId is not defined"

**Step 3: Write minimal implementation**

```ts
// src/lib/eventlog/event-id.ts
export function createEventId(deviceId: string, timeMs: number, seq: number): string {
  return `${deviceId}:${timeMs}:${seq}`;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/eventlog/event-id.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/eventlog/event-id.test.ts src/lib/eventlog/event-id.ts
git commit -m "feat: add event id generator"
```

### Task 2: EventLog Schema 升级（事件语义/内容载体拆分）

**Files:**
- Modify: `src/lib/eventlog/format.ts`
- Modify: `src/lib/types/message.ts`
- Modify: `tests/unit/eventlog/format.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/eventlog/format.test.ts (新增断言)
const event = createEventLog({
  event_type: 'chat',
  content_type: 'text',
  content_text: 'hello',
  device_id: 'device-001',
  sender_type: 'user',
  sender_id: 'user-001',
  target_type: 'user',
  target_id: 'user-001',
});
expect(event.event_type).toBe('chat');
expect(event.content_type).toBe('text');
expect(event.sender_type).toBe('user');
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/eventlog/format.test.ts`
Expected: FAIL (missing fields)

**Step 3: Write minimal implementation**

```ts
// src/lib/eventlog/format.ts
export type SenderType = 'user' | 'agent' | 'system';
export type TargetType = 'user' | 'agent' | 'device' | 'group' | 'channel';
export type EventType = 'chat' | 'time_block' | 'system_log';
export type ContentType = 'text' | 'image' | 'file' | 'json';

export interface EventLog {
  event_id: string;
  event_time_ms: number;
  device_id: string;
  sender_type: SenderType;
  sender_id: string;
  target_type?: TargetType;
  target_id?: string;
  event_type: EventType;
  content_type: ContentType;
  content_text?: string;
  content_media?: Record<string, unknown>;
  tags?: string[];
  time_block_id?: string;
  phase?: 'start' | 'end' | 'point';
  meta?: Record<string, unknown>;
}

export function createEventLog(input: Omit<EventLog, 'event_id' | 'event_time_ms'> & {
  event_id?: string;
  event_time_ms?: number;
}): EventLog {
  return {
    ...input,
    event_id: input.event_id || crypto.randomUUID(),
    event_time_ms: input.event_time_ms || Date.now(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/eventlog/format.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/eventlog/format.ts src/lib/types/message.ts tests/unit/eventlog/format.test.ts
git commit -m "feat: expand event log schema"
```

### Task 3: 事件存储 + Markdown 镜像

**Files:**
- Create: `src/lib/eventlog/store.ts`
- Modify: `src/lib/eventlog/writer.ts`
- Modify: `src/lib/eventlog/reader.ts`
- Modify: `tests/unit/eventlog/write.test.ts`
- Modify: `tests/unit/eventlog/read.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/eventlog/write.test.ts (新增)
const writer = createWriter({
  path: '/test/eventlog.jsonl',
  fs: { appendFile: mockAppendFile, readFile: mockReadFile }
});
await writer.append(event);
expect(mockAppendFile).toHaveBeenCalledTimes(1);
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/eventlog/write.test.ts`
Expected: FAIL (appendFile not used)

**Step 3: Write minimal implementation**

```ts
// src/lib/eventlog/writer.ts
export interface FileSystem {
  appendFile: (path: string, data: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
}

async append(event: EventLog): Promise<void> {
  const line = JSON.stringify(event) + '\n';
  await this.fs.appendFile(this.path, line);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/eventlog/write.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/eventlog/writer.ts tests/unit/eventlog/write.test.ts
git commit -m "feat: append event log with jsonl"
```

### Task 4: 前端事件流与 UI 事件日志展示

**Files:**
- Modify: `src/lib/sync/message-storage.ts`
- Modify: `src/lib/stores/chat-store.ts`
- Modify: `src/components/Chat/ChatWindow.tsx`
- Modify: `tests/components/chat-window.test.tsx`

**Step 1: Write the failing test**

```ts
// tests/components/chat-window.test.tsx
expect(screen.getByText('个人事件日志')).toBeInTheDocument();
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/components/chat-window.test.tsx`
Expected: FAIL (old title)

**Step 3: Write minimal implementation**

```tsx
// src/components/Chat/ChatWindow.tsx
<h1>个人事件日志</h1>
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/components/chat-window.test.tsx`
Expected: PASS (note: 当前基线测试仍有其它失败)

**Step 5: Commit**

```bash
git add src/components/Chat/ChatWindow.tsx tests/components/chat-window.test.tsx
git commit -m "feat: rename chat header to event log"
```

### Task 5: 电脑端 WebSocket 服务端（主机）

**Files:**
- Modify: `src-tauri/src/sync/ws_server.rs`
- Create: `src-tauri/src/commands/ws_server_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Write the failing test**

```rust
// src-tauri/src/sync/ws_server.rs (新增测试)
#[tokio::test]
async fn server_starts_and_reports_running() {
    let (tx, _rx) = mpsc::channel(100);
    let running = Arc::new(AtomicBool::new(false));
    let server = WsServer::new("127.0.0.1", 19000, tx, running.clone());
    assert!(!server.is_running());
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind`  
Expected: FAIL (missing command integration)

**Step 3: Write minimal implementation**

```rust
// src-tauri/src/commands/ws_server_commands.rs
#[tauri::command]
pub async fn ws_server_start(host: String, port: u16, state: State<'_, Arc<WsServerState>>) -> Result<(), String> {
  state.start(host, port).await
}
```

**Step 4: Run test to verify it passes**

Run: `cargo test -p exomind`  
Expected: PASS for added tests

**Step 5: Commit**

```bash
git add src-tauri/src/sync/ws_server.rs src-tauri/src/commands/ws_server_commands.rs src-tauri/src/lib.rs
git commit -m "feat: add ws server commands for lan host"
```

### Task 6: 双设备事件同步（主机广播 + 客户端接收）

**Files:**
- Modify: `src-tauri/src/commands/ws_commands.rs`
- Modify: `src/lib/sync/websocket-client.ts`
- Create: `src/lib/sync/event-sync.ts`
- Modify: `tests/sync/sync-protocol.test.ts`

**Step 1: Write the failing test**

```ts
// tests/sync/sync-protocol.test.ts (新增)
const msg = protocol.createChangeMessage('event', { event_id: 'device-1:1:1' });
expect(msg.payload).toEqual({ entity: 'event', data: { event_id: 'device-1:1:1' } });
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/sync/sync-protocol.test.ts`
Expected: FAIL (message shape mismatch)

**Step 3: Write minimal implementation**

```ts
// src/lib/sync/event-sync.ts
export function createEventSyncMessage(event: EventLog) {
  return { type: 'CHANGE', payload: { entity: 'event', data: event }, timestamp: Date.now(), deviceId: event.device_id };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/sync/sync-protocol.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/sync/event-sync.ts tests/sync/sync-protocol.test.ts
git commit -m "feat: add event sync messages"
```

### Task 7: MCP 访问事件日志（通过 mcp-server-tauri）

**Files:**
- Create: `src-tauri/src/commands/eventlog_commands.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `docs/specs/mcp-eventlog.md`

**Step 1: Write the failing test**

```rust
// src-tauri/src/commands/eventlog_commands.rs (新增测试)
#[test]
fn eventlog_append_serializes_jsonl() {
    // TODO: use temp dir and assert file content contains event_id
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test -p exomind`  
Expected: FAIL (command not implemented)

**Step 3: Write minimal implementation**

```rust
// src-tauri/src/commands/eventlog_commands.rs
#[tauri::command]
pub async fn eventlog_append(app: AppHandle, event: serde_json::Value) -> Result<(), String> {
  // serialize event to jsonl and append to data/eventlog.jsonl
  Ok(())
}
```

**Step 4: Run test to verify it passes**

Run: `cargo test -p exomind`  
Expected: PASS for added tests

**Step 5: Commit**

```bash
git add src-tauri/src/commands/eventlog_commands.rs src-tauri/src/lib.rs docs/specs/mcp-eventlog.md
git commit -m "feat: add mcp event log commands"
```

---

## MCP 交互说明（摘要）
- Agent 通过 `mcp-server-tauri` 调用 `ipc_execute_command` 来执行 `eventlog_append` / `eventlog_list`。
- 事件写入遵循同一事件模型与去重规则，写入后 UI 与 `event_log.md` 同步更新。

## Definition of Done
- 手机端可输入事件，电脑端可接收并显示（同一局域网）。
- 事件写入同时出现在 JSONL 与 `event_log.md`。
- MCP 可读写事件（通过 `ipc_execute_command`）。

