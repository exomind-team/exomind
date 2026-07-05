# 设备配对流程技术文档（Device Pairing Flow / Node-First Pairing）

> **Legacy HTTP mesh 配对资料**：本文说明的是 node-first / `/mesh/pairing/*` / HTTP mesh pairing 旧路径，不能作为 Reticulum/ENS 授权闭环的当前依据。Reticulum/ENS 当前以 `identity_hex` 为 trust、discovery、pairing、delivery 主键；只用 `docs/plans/2026-06-08-reticulum-next-agent-handoff.md` 和 `docs/development/reticulum-dual-instance-verification.md` 判断下一步。
>
> 更新日期：2026-03-31  
> 关联 issue / PR：[#773](https://github.com/exomind-team/exomind/issues/773)、[#774](https://github.com/exomind-team/exomind/pull/774)  
> 目标读者：前端 / Runtime / QA / 联调同学

---

## 1. 文档目标

这篇文档说明 ExoMind 在 `网络 -> 设备` 主路径下的 **node-first pairing（节点优先配对）** 是如何工作的，重点覆盖：

- `discovery（发现）`
- `pairing（PIN 配对）`
- `confirmed peer（可信节点）`
- `link proof（互通验证）`
- `Android emulator（Android 模拟器）` 的地址映射差异

它解决两个常见问题：

1. 配对流程涉及多个前端服务、Runtime HTTP API 与信号历史，单看某一个文件不容易理解全链路。
2. 在桌面 + Android 模拟器场景下，`advertised address（对外宣告地址）`、`dial address（实际拨号地址）`、`reachable address（反向可达地址）` 不是同一个值，容易把 peer 地址写错。

---

## 2. 推荐产品路径

当前推荐的产品路径不是“客户端直接手工填写某台 RT 地址”，而是：

1. 每台设备运行自己的 `embedded RT（内嵌运行时）`
2. 设备切到 `LAN / 局域网` 模式，允许 mDNS 发现
3. 通过 `设备配对` 建立 `confirmed peer（可信节点）`
4. 自动执行 `link proof（链路验证）`
5. 用户在 `已确认节点` 中看到 `已验证互通`

只有兼容旧链路、调试桥接或临时接入外部 RT 时，才进入：

- `高级 / 兼容模式`
- `external RT（外部 RT）`
- `手工 host:port`

---

## 3. 相关组件与职责

| 组件 | 职责 | 关键文件 |
|------|------|----------|
| `PeerPairingDialog` | 发起配对 / 响应配对 / 自动收敛验证上下文 | `src/ui/app/components/PeerPairingDialog.tsx` |
| `RuntimeMeshSyncService` | 调 Runtime `/mesh/*` 接口，写入本地与远端 mesh peer | `src/lib/services/runtime-mesh-sync.service.ts` |
| `RuntimeMeshHostSyncService` | 把 Runtime mesh 状态同步到前端 host store | `src/lib/services/runtime-mesh-host-sync.service.ts` |
| `RuntimeLinkProofService` | 发布 / 轮询 `system.link_proof.*` 信号，完成双向 RTT 验证 | `src/lib/services/runtime-link-proof.service.ts` |
| `RuntimeControlService` | 查询本机 runtime 状态、推导可达地址与拨号地址 | `src/lib/services/runtime-control.service.ts` |
| `TauriRuntimeAdapter` | 调用 Tauri IPC / Rust 命令实现网络能力 | `src/lib/adapters/tauri-runtime-adapter.ts` |

---

## 4. 核心数据模型

### 4.1 `RuntimeHostRecord` 在配对链路中的语义

| 字段 | 语义 | 备注 |
|------|------|------|
| `host / port` | 当前记录展示用主地址 | 对于 Android 模拟器，会保留 guest 地址用于 UI 与 mDNS 语义 |
| `advertisedListenAddress` | 对端通过发现看到的地址 | 例如 `10.0.2.15:9124` |
| `manualOverride` | 拨号覆盖地址 | 例如桌面通过 ADB forward 拨到 `127.0.0.1:39124` |
| `lastSuccessfulDialAddress` | 最近一次成功拨号地址 | 正常情况下优先于 `manualOverride` |
| `trustState` | `discovered_candidate` / `confirmed_peer` / `manual_seed` | 设备页主路径主要依赖前两种 |
| `hostId` | Runtime 逻辑节点 ID | 真正识别 peer 身份的主键 |

### 4.2 为什么要区分“展示地址”和“拨号地址”

对于普通局域网设备：

- `advertised address`
- `dial address`
- `reachable address`

往往是同一个值。

但在桌面 + Android 模拟器场景中，这三个值会分裂：

- Android mDNS 对外广播：`10.0.2.15:9124`
- 桌面实际拨号：`127.0.0.1:39124`（ADB forward）
- Android 回拨桌面：`10.0.2.2:11240`

因此系统必须把：

- UI 展示与 host identity 继续绑定在 guest 地址
- 实际连接行为绑定在 dial address
- 反向写回 peer 时使用 reachable / host alias

---

## 5. 端到端流程

## 5.1 Discovery（发现）

1. 设备启动 `embedded RT`
2. 设备切换到 `LAN`
3. Runtime 通过 mDNS 广播自己的 `host_id + host + port`
4. 本地前端调用：
   - `GET /mesh/discovered`
5. `RuntimeMeshHostSyncService` 将发现结果映射到 `RuntimeHostRecord`
6. 设备页显示在 `已发现节点`

关键点：

- 主路径不要求手工录入地址
- `已发现节点` 只代表“可见”，不代表“可信”

## 5.2 Initiator（发起方）

发起方在 `PeerPairingDialog` 中点击 `发起配对` 后：

1. 调用本地 Runtime：
   - `POST /mesh/pairing/initiate`
2. Runtime 返回：
   - `session_id`
   - `pin`
3. UI 展示 PIN，并开始轮询：
   - `GET /mesh/peers`
4. 一旦本地 Runtime 出现新 peer，发起方继续等待：
   - host store 中出现 `confirmed_peer`
   - `system.link_proof.request` 到达本地信号历史
5. 上下文就绪后，以 `joiner` 身份参与自动验证

这一步的设计目的，是让“PIN 成功”与“链路真正可用”分开收敛，避免 UI 过早把状态写成“成功”。

## 5.3 Responder（响应方）

响应方在 `PeerPairingDialog` 中点击 `响应配对` 后：

1. 持续轮询本地 Runtime：
   - `GET /mesh/discovered`
2. 用户选择目标 peer，并输入 6 位 PIN
3. 通过 `RuntimeControlService.getPeerDialAddress()` 解析发起方拨号地址
4. 通过 `getReachableAddress()` 或模拟器 host alias 规则，计算自己对发起方可见的 `responder_base_url`
5. 调用发起方 Runtime：
   - `POST <initiatorBaseUrl>/mesh/pairing/respond`
6. 如果 PIN 正确，响应方再把发起方注册进本地 Runtime：
   - `POST <localRuntimeBaseUrl>/mesh/peers`
7. 之后以 `owner` 身份发起自动 `link proof`

---

## 6. Link Proof（互通验证）流程

`RuntimeLinkProofService` 通过信号历史完成双向验证：

1. owner 发送：
   - `system.link_proof.request`
2. 对端收到后返回：
   - `ack_kind=receipt`
3. owner 记录本端 RTT
4. owner 再发送：
   - `ack_kind=result`
5. joiner 等待对端 result，记录对端 RTT
6. 两端都把 host metadata 更新为：
   - `verificationStatus = verified`
   - `lastVerificationTrigger = pairing_auto` 或 `manual_retry`
   - `localInitiatedRttMs / peerInitiatedRttMs`

手动点击 `测试互联` 时，会复用相同的 proof 机制，只是触发来源改为：

- `manual_retry`

---

## 7. 地址选择规则（最关键）

## 7.1 普通局域网设备

普通设备场景下，原则很简单：

- `discovered address` 作为默认连接目标
- `getPeerDialAddress()` 只做必要的拨号修正
- `getReachableAddress()` 用于告诉对端“怎么回拨我”

## 7.2 Android 模拟器

Android 模拟器必须额外遵守三条规则：

### 规则 A：保留 guest endpoint 作为 host identity

当桌面通过 mDNS 发现 Android 模拟器时，发现地址通常是：

- `10.0.2.15:9124`

这个地址应该继续保留在 host store 的：

- `host / port`
- `advertisedListenAddress`

因为它代表“这个节点是谁”。

### 规则 B：拨号可走 ADB loopback

桌面实际拨号 Android 时，可能会走：

- `127.0.0.1:39124`

这个地址只应该进入：

- `manualOverride`
- `lastSuccessfulDialAddress`

而不应该覆盖 host identity。

### 规则 C：Android 回拨桌面必须走 host alias

当 Android 模拟器需要回拨桌面时，不能把桌面地址写成：

- `127.0.0.1:11240`

也不能把自己错误地回写成：

- `10.0.2.2:9124`

正确规则是：

- Android 访问宿主机使用 `10.0.2.2` 或 `10.0.3.2`
- 因此桌面 peer 写入 Android `/mesh/peers` 时，应该是：
  - `http://10.0.2.2:<desktopPort>`

本轮 `#773` 的修复，核心就是把这三层语义重新拆开。

---

## 8. 本轮修复后的行为约束

### 8.1 `RuntimeMeshHostSyncService`

当已存在 host 是 Android emulator guest 地址，而 confirmed peer 的 `base_url` 又是桥接别名时：

- 保留原来的 guest endpoint 作为 `host / port`
- 把 loopback 只放在 `manualOverride`

这样 UI 看到的仍然是：

- `Node rt-xxxx (10.0.2.15:9124)`

而不是被污染成：

- `Node rt-xxxx (127.0.0.1:39124)`

### 8.2 `RuntimeMeshSyncService`

写 reciprocal peer（反向 peer）时：

- 先用解析后的 `remoteBaseUrl` 计算 reachable address
- 如果检测到“本地通过 ADB / bridge 正在拨号 Android 模拟器”，则直接把回写地址固定为 host alias：
  - `10.0.2.2`
  - `10.0.3.2`

### 8.3 `PeerPairingDialog`

响应配对时：

- 选择 peer 展示地址和拨号地址分离
- 发给 initiator 的 `responder_base_url` 必须满足回拨规则

---

## 9. 验收标准（Acceptance Criteria）

推荐按以下口径验收：

1. 不手工录入 `host:port`
2. 桌面与 Android 都使用 `embedded RT`
3. 桌面 `/mesh/discovered` 能看到 Android
4. PIN 配对成功
5. 自动 `pairing_auto` proof 成功
6. 手动 `测试互联` 成功
7. 两端 UI 都显示 `已验证互通`
8. 地址满足：
   - Desktop `/mesh/peers` 中 Android 为拨号地址，例如 `127.0.0.1:39124`
   - Android `/mesh/peers` 中 Desktop 为 host alias，例如 `10.0.2.2:11240`

详细手工验收清单见：

- `docs/testing/2026-03-30-mdns-link-proof-manual-checklist.md`

---

## 10. 常见故障定位

### 10.1 配对成功，但仍显示“未验证互通”

优先检查：

- 两端是否都出现 `system.link_proof.request`
- 是否至少有一侧出现 `system.link_proof.ack`
- host store 是否已经收敛为 `confirmed_peer`

高频原因：

- proof request 被发出，但对端没有正确回执
- UI 提前进入 success，实际 verification context 还没准备好

### 10.2 Android 端看到的桌面地址是 `127.0.0.1`

这通常意味着回写 peer 时用了错误的 reachable address 语义。优先检查：

- `RuntimeMeshSyncService.ensurePeerPair()`
- `resolveAndroidEmulatorHostAlias()`
- `responder_base_url` 是否仍然用 loopback

### 10.3 桌面端把“已确认节点”显示成自己

这通常意味着 host store 把 guest endpoint 覆盖成了 loopback。优先检查：

- `RuntimeMeshHostSyncService.upsertConfirmedPeer()`
- `manualOverride` 是否错误覆盖了 `host / port`

---

## 11. 推荐阅读

- `docs/development/lan-single-rt-guide.md`
- `docs/testing/2026-03-30-mdns-link-proof-manual-checklist.md`
- `src/ui/app/components/PeerPairingDialog.tsx`
- `src/lib/services/runtime-mesh-sync.service.ts`
- `src/lib/services/runtime-mesh-host-sync.service.ts`
- `src/lib/services/runtime-link-proof.service.ts`
