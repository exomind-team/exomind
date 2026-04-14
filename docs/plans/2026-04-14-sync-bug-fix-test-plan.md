# 双客户端全域同步 Bug 调查测试计划

**创建日期：** 2026-04-14
**状态：** 待执行
**关联验证章程：** [2026-04-14-two-client-full-domain-sync-validation-charter](2026-04-14-two-client-full-domain-sync-validation-charter.md)

---

## 1. 背景与已知发现

### 1.1 Round 1 + Round 3 实测结论（已确认）

四域在 pairing 后**全部自动收敛**，原始 bug 假设（EventLog/TimeBlock 失败）**不成立**。

**Round 3（TMCP-FULLSYNC-20260414-R3）RT truth 结果：**

| 域 | A端 | B端 | 收敛延迟 | 判定 |
|---|---|---|---|---|
| EventLog | 120 | 120 | 22ms | ✅ PASS |
| Tasks | 120 (hash=`fa040765...`) | 120 (同一 hash) | 22ms | ✅ PASS |
| TimeBlocks | 120 | 120 | 22ms | ✅ PASS |
| Proposals | 120 | 120 | 22ms | ✅ PASS |

### 1.2 Bulk-sync 脚本误判原因

脚本报告 `eventlog=0, timeblocks=0` on B 端是**误判**，非产品 bug。

**根本原因：** 轮询快照采集发生在 B 端 backfill coordinator 触发第一轮 `setInterval` 回调之前（15s 间隔）。B 端数据实际已在 pairing 后自动收敛（481 条 EventLog 已在），但采集时机早于 backfill 首次触发。

**经验教训：** 轮询快照必须在主动触发 `backfillConfirmedPeers()` 并等待完成后采集，不能依赖"初始 0 值 + 自然等待 15s"。

### 1.3 当前环境状态

- full-sync-c: Web=1520, RT=9224, bridge=9323
- full-sync-d: Web=1540, RT=9244, bridge=9343
- 两侧均保持 Round 1 的 481/601/600/600 数据

---

## 2. 待修复的真实问题

### 2.1 问题 A：Bulk-sync 脚本 Login Bypass

**现象：** 脚本传了新的 `--profile-slug`，但因"已登录"直接沿用了旧 profile，未执行新 seed。

**根因：** `bootstrapProfile` 逻辑中 `already_logged_in` 检查返回 true 时跳过 profile 切换。

**修复方向：** profile 切换时强制登出当前 session，再创建/切换到新 profile。

### 2.2 问题 B：Bulk-sync 脚本报告时机

**现象：** 轮询快照在 backfill 触发前采集，导致误判。

**修复方向：** B 端 spot check 前主动调用 `backfillConfirmedPeers()` 并等待完成，再采集 RT truth 快照。

### 2.3 问题 C：mDNS hostId 注入空值

**现象：** A 端 mesh/peers 中 peer 的 `hostId=""`（空字符串），说明 `AuthenticatedPeerIdentity` 未正确注入 `peer_host_id`。

**影响：** 虽然四域实际同步正常（因为另一端直接拿到 base_url），但 hostId 为空可能导致某些依赖 `hostId` 的 backfill 路径失效。

**修复方向：** 检查 `mesh.rs` 中 `AuthenticatedPeerIdentity` 的注入链路，确认 mDNS peer 的 `host_id` 字段是否正确设置。

---

## 3. 第三轮实测计划

### 3.1 目标

在修复问题 A + B 后，执行一次严格的双客户端全域同步验证，验证叙事：

> 客户端 A 在配对前已积累大量业务数据；客户端 B 在零状态下与 A 完成设备配对；配对进入 `confirmed + verified` 后，无需手工导入，B 能在连续观察窗口内自动收敛。

### 3.2 前置条件

- [ ] 问题 A 修复：`bootstrapProfile` 支持强制 profile 切换
- [ ] 问题 B 修复：B 端 spot check 前主动触发 backfill 并等待
- [ ] 两端 Tauri 实例全新拉起（清理旧状态）
- [ ] 新 profile slug（与 Round 1 不同，避免数据污染）

### 3.3 执行步骤

#### Step 0：清理现场

```bash
# 停止现有实例
bun scripts/dev/tauri-dev-manager.ts stop --name full-sync-c
bun scripts/dev/tauri-dev-manager.ts stop --name full-sync-d
sleep 3

# 串行拉起新实例
bun scripts/dev/tauri-dev-manager.ts start --name full-sync-r3-a --target desktop --web-port 1520 --hmr-port 1521 --rt-port 9224
sleep 5
bun scripts/dev/tauri-dev-manager.ts start --name full-sync-r3-b --target desktop --web-port 1540 --hmr-port 1541 --rt-port 9244
```

#### Step 1：验证现场真值

| 字段 | A (full-sync-r3-a) | B (full-sync-r3-b) |
|---|---|---|
| Web 端口 | 1520 | 1540 |
| RT 端口 | 9224 | 9244 |
| bridge 端口 | 9323 | 9343 |
| runtime host id | 待填 | 待填 |
| profile session | 待填 | 待填 |

#### Step 2：A 端 bulk seed（120 条/域）

```bash
bun scripts/dev/tauri-full-domain-bulk-sync.ts \
  --name-a full-sync-r3-a --name-b full-sync-r3-b \
  --profile-slug tmcp-fullsync-20260414-r3 \
  --profile-password tmcp-123456 \
  --seed-count 120 \
  --run-id TMCP-FULLSYNC-20260414-R3 \
  --step seed-only
```

验证 A 端 seed 结果后记录 baseline。

#### Step 3：B 端确认零状态

B 端 `user_id=profile-tmcp-fullsync-20260414-r3` 查询应返回空或 baseline。

#### Step 4：配对 + backfill

执行 pairing，然后**主动触发 B 端 backfill**：

```javascript
// 通过 B 端 raw bridge 执行
await window.__rt_domain_backfill__?.backfillConfirmedPeers();
// 或通过 RT HTTP API 触发
```

等待 backfill 完成（观察 30s）。

#### Step 5：RT truth 快照采集

使用带 `user_id` 过滤的 RT HTTP API 采集四域计数：

```bash
# EventLog
curl "http://127.0.0.1:9244/eventlog?user_id=profile-tmcp-fullsync-20260414-r3" | jq length

# Tasks replication summary
curl "http://127.0.0.1:9244/tasks/replication/summary?user_id=profile-tmcp-fullsync-20260414-r3"

# TimeBlocks
curl "http://127.0.0.1:9244/timeblocks?user_id=profile-tmcp-fullsync-20260414-r3" | jq length

# Proposals
curl "http://127.0.0.1:9244/api/proposals?user_id=profile-tmcp-fullsync-20260414-r3" | jq length
```

#### Step 6：与 A 端对比

四域 B 端计数应与 A 端完全一致。

### 3.4 成功标准

| 条件 | 判定 |
|---|---|
| 四域 B 端计数 == A 端计数 | ✅ |
| Tasks revision_hash B == A | ✅ |
| B 端 snapshot 在 backfill 触发后 60s 内收敛 | ✅ |
| 无路由 404/500 错误 | ✅ |
| peer hostId 非空 | ✅（如果可行） |

### 3.5 失败处理

如果某域收敛失败：

1. 记录 B 端 RT truth 快照（含具体缺失的 sample IDs）
2. 记录 RT 日志中 backfill 相关 warn/error
3. 用 raw bridge 执行 peer snapshot 路由获取 B 端实际导入请求返回码
4. 对比 A 端 mesh/eventlog grants reconcile 结果与 B 端

---

## 4. 问题 C 调查计划（独立于 Round 3）

### 4.1 目标

确认 mDNS peer 的 `hostId` 为空是否影响现有 backfill 路径。

### 4.2 调查步骤

1. 读取 `crates/exomind-runtime/src/routes/mesh.rs` 中 peer snapshot 路由的鉴权逻辑
2. 确认 `AuthenticatedPeerIdentity` 如何从 peer token 提取 `host_id`
3. 检查 mDNS discovery 阶段是否设置了 `host_id`
4. 如果路径确认 hostId 依赖但实际为空，定位具体缺失点

---

## 5. 参考资料

- [验证章程](./2026-04-14-two-client-full-domain-sync-validation-charter.md)
- [Tauri MCP Windows Playbook](../development/tauri-mcp-windows-playbook.md)
- [多 Worktree 端口配置](../development/port-env-configuration.md)
- Bulk-sync 脚本：`scripts/dev/tauri-full-domain-bulk-sync.ts`
- Backfill 服务：`src/lib/services/rt-domain-backfill.service.ts`
- EventLog backup 服务：`src/lib/services/eventlog-backup.service.ts`
