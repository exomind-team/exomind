# ADR-005: 三态定义下沉到 transport 层 + mode 过滤替代接口增删

## 状态

已实施（2026-05-26）

## 背景

Reticulum mesh 接口需要三态控制（Off/Passive/Active）。初始实现用了 `remove_interface()` 加 CancellationToken 来"禁用"接口，无法恢复，且三态概念定义在应用层（`exomind-net-pairing`）。

需要解决两个问题：
1. 三态是连接本身的属性，应定义在最底层
2. "禁用"不是销毁重建，而是按状态过滤

## 决策

### 1. InterfaceMode enum 定义在 `reticulum-rs`

```rust
// reticulum-rs/src/iface.rs
pub enum InterfaceMode {
    Off = 0,      // 不参与任何收发
    Passive = 1,  // 仅接收，不转发 announce
    Active = 2,   // 完整收发
}
```

附带 trait：`Display`, `From<u8>`, `serde::Serialize/Deserialize`, `Ord`（用于 `min()`）。

上层通过 `pub use` 引用：
```rust
// exomind-net-pairing/src/lib.rs
pub use reticulum::iface::InterfaceMode as RetMeshMode;
```

### 2. mode 过滤替代增删

`LocalInterface` 存储 `mode: InterfaceMode`，`InterfaceManager::send()` 中按 `min(global, iface)` 过滤：

```rust
pub async fn send(&self, message: TxMessage) {
    for iface in &self.ifaces {
        let effective = self.global_mode.min(iface.mode);
        if effective == InterfaceMode::Off { continue; }
        if is_announce && effective == InterfaceMode::Passive { continue; }
        // ... 正常发送 ...
    }
}
```

- 接口不销毁，只切换 mode
- 全局模式作为上限（`min(global, iface)`），不改变接口自己的 mode
- 前端三段式按钮直接选用目标状态，不循环切换

### 3. `AppState.ret_mesh_mode` 统一用 enum

```rust
// Before: Arc<AtomicU8> + as u8 + .into()
// After: Arc<Mutex<InterfaceMode>> — 直接存取
```

## 后果

正面：
- 类型系统保证无非法状态（不存在 mode=3）
- 接口列表始终完整，UI 不会因为 disable 而消失
- 全局与接口 mode 的关系由 `min()` 自然表达

负面：
- `reticulum-rs` 需要 `serde` 依赖（已有）
- `Mutex<InterfaceMode>` 比 `AtomicU8` 略重（但 mode 变更频率极低，可忽略）

## 关联

- `docs/architecture/physical-connectivity-layer.md §4`
- `docs/plans/Plan1-Reticulum-Phase1-全面推进.md §设计决策`
