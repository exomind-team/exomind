# ADR-006: SSE-Driven UI 同步 — 不做乐观更新

## 状态

已实施（2026-05-26）

## 背景

Reticulum mesh 的 UI 控件（全局模式开关、接口三态按钮）需要更新后端状态并反映到界面上。有两种方案：
- **乐观更新**：点击后立即更新本地 state，再异步发请求
- **SSE 驱动**：只发请求，等后端推 SSE snapshot 来更新 UI

## 决策

选用 **SSE-driven**，不做乐观更新。

**链路**：
```
点击按钮 → fetch POST → 后端处理 → 推 SSE snapshot → 前端 setState
```

**所有 Reticulum 状态按钮遵循同一模式**：
- 总闸（`handleAnnounceModeChange`）：只发 fetch，不碰本地 state
- 接口三态（`handleSetInterfaceMode`）：同上

## 理由

1. **一致性**：总闸和接口按钮行为完全一致。用户看到的永远是真值，不会出现"按钮点了但后端拒绝"的不一致窗口
2. **多订阅者**：SSE broadcast 使所有窗口、所有 agent 同时看到同一状态
3. **简化前端逻辑**：不需要 optimistic rollback、不需要 loading state 管理
4. **SSE snapshot 已为推送机制**：`ret_mesh_event_tx` 的 broadcast channel 已在用，不增加新基础设施

## 后果

正面：
- UI 状态总是正确的
- 错误处理天然在 backend（错误的 mode 值根本不会进 SSE）
- 前端代码更短，不需要 `setInterfaces` 再 fetch

负面：
- 按钮点击到 UI 反馈有 SSE 延迟（~10s tick 或 snapshot 触发后立即）
- 网络失败时用户看不到错误（fetch 静默 catch，下个 snapshot 自动更正）
- 需要确保所有变更路径都触发了 SSE snapshot push

## 关联

- `docs/plans/Plan1-Reticulum-Phase1-全面推进.md §设计决策 D3`
- `crates/exomind-runtime/src/lib.rs ret_mesh_background` — snapshot 推送
- `src/ui/app/pages/agents/DeviceView.tsx` — SSE 处理
