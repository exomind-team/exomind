# Plan: ret_mesh_background tick 卡死修复

## Context

`ret_mesh_background` 的 `tokio::select!` 循环在 tick #2 之后卡死，导致：
- SSE 快照停止推送
- HTTP API (`/mesh/ret/*`) 响应超时
- 前端无法获取 Reticulum 状态

## 已确认的事实

1. tick #1 正常完成（discovered.write → iface_manager.lock → try_push_snapshot 全部通过）
2. tick #2 在 `AFTER discovered.write()` 之后卡住，永远到不了 `BEFORE iface_manager.lock()`
3. `on_peer_resolved` 本身快速完成（2个 peer 均 NEW，add_udp_interface 立即返回）
4. `on_peer_resolved` 诊断日志：startup 阶段 2 个 NEW peer 正常，tick 阶段无新 peer

## 卡点代码路径

tick handler 中 `AFTER discovered.write()` 和 `BEFORE iface_manager.lock()` 之间的代码：

```rust
// 1. evict stale peers (sync, quick)
// 2. expire pending pairings (sync, quick)
// 3. mDNS peer discovery → on_peer_resolved().await
// 4. file registry scan → on_peer_resolved().await
```

## 诊断日志已就位

- `tick-debug BEFORE/AFTER discovered.write()`
- `tick-debug BEFORE/AFTER iface_manager.lock()`
- `tick-debug BEFORE/AFTER try_push_snapshot`
- `on_peer_resolved: SKIP/NEW + BEFORE/AFTER add_udp_interface`
- `tick-debug mDNS/registry new peer + on_peer_resolved done`

## 待排查

1. tick #2 日志中 `AFTER discovered.write()` 之后是否有 mDNS/registry 新 peer 的 warn 日志
2. 如果没有 → 代码在 evict stale peers 或 expire pending pairings 之后卡住（但这些是 sync 代码）
3. 如果有 → `on_peer_resolved` 内部某个 `.await` 阻塞（`known.read()` 或 `add_udp_interface` 的 `iface_manager.lock()`）

## 修复策略

### 方案 A：添加超时保护

在 tick handler 的所有 `.await` 调用上包裹 `tokio::time::timeout`：

```rust
match tokio::time::timeout(Duration::from_secs(10), mdns_bridge.on_peer_resolved(...)).await {
    Ok(()) => {},
    Err(_) => tracing::warn!("[tick] on_peer_resolved timeout"),
}
```

### 方案 B：隔离 tick handler 中的阻塞操作

将 `on_peer_resolved` 和文件注册表扫描移到 tick handler 外部，通过 channel 异步通知。

### 方案 C：添加更多诊断日志

在 evict stale peers 和 expire pending pairings 之间、之后各加一行 warn 日志，精确定位卡点。

## 根因（已定位 2026-05-27）

**整数溢出 panic** — `lib.rs:2370` 原始代码 `peer.port + 6000` 在 `peer.port > 59535` 时 u16 溢出。

触发条件：mDNS 发现旧版实例（`ret_port=0`），fallback 计算 `port + 6000` 溢出 → panic 杀死整个 `ret_mesh_background` task → SSE 停止推送。

实际日志证据：
```
[22:21:38] [tick-debug] AFTER discovered.write() tick#2
thread 'tokio-rt-worker' panicked at lib.rs:2370:33:
attempt to add with overflow
```

mDNS peer: `rt-4515bc55...` port=62349, ret_port=0 → 62349+6000=68349 > 65535 → overflow。

## 修复（已完成）

`ret_port=0` 时跳过该 peer（无法确定 Reticulum 端口，不应猜测），而非 fallback 到可能溢出的 `port + 6000`。

修改位置：`crates/exomind-runtime/src/lib.rs` tick handler 中 mDNS peer discovery 段。
