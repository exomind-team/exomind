# Reticulum 组网配对模型设计

> 日期：2026-05-24
> 状态：设计锁定版
> 性质：这是外心 Reticulum 组网配对的目标态架构设计，不是当前代码现状
> 关联：
> - `feat/ret-mesh-prototype` 分支（Phase 1 实现）
> - #906 搬迁式重构
> - exomind-net-pairing crate (Phase 1)

---

## 背景

Phase 1 已在 `exomind-net-pairing` crate 中实现了 Reticulum Transport 的发现与 TCP 连通性验证。双实例通过 RET_MESH_SEED 成功互见，证明 Reticulum TCP Interface 可在局域网内传输 Announce 并触发设备发现。

但现有的「配对」模型（`pairing.rs` + `/mesh/pairing/*` HTTP 路由）与 Reticulum 传输层之间存在架构错位：

| 层面 | 当前实现 | 问题 |
|------|---------|------|
| 传输层 | HTTP/1.1 + SSE（Bearer token 鉴权） | 与传输耦合，不通用 |
| 发现层 | mDNS + HTTP 配对 | mDNS 在跨网络/蓝牙场景不可用 |
| 授权层 | PIN + session + per-peer inbound token | 逻辑正确，但与 HTTP 绑定 |

Phase 2 的目标是将传输层和授权层解耦，使外心可以在 Reticulum mesh 之上保留 PIN 验证的安全属性，同时获得介质无关的传输能力。

---

## 三层架构

```
┌─────────────────────────────────────────────┐
│          外心软件层（应用授权）                │
│  pairing.rs 的 PIN/session 逻辑              │
│  授权决策 = 人在场的证明（配对码）            │
│  访问控制 = per-peer 权限表                  │
├─────────────────────────────────────────────┤
│          Reticulum 设备状态模型              │
│  Discovered → Paired → Trusted → Disconnected│
│  映射到 UI 展示                              │
├─────────────────────────────────────────────┤
│          Reticulum Transport 层              │
│  Identity / Announce / Link / Interface      │
│  只管连接，不管授权                          │
└─────────────────────────────────────────────┘
```

### 原则

1. **传输与授权分离**：Reticulum Transport 只负责「能不能连」，不负责「谁能连」
2. **PIN 是人的在场证明，不是技术校验**：配对码的意义在于「只有人能传递这个码」，而非密码学强度
3. **状态模型与传输介质无关**：Discovered/Paired/Trusted 等状态在 Reticulum、HTTP、蓝牙上共享同一套语义

---

## 第一层：Reticulum Transport（传输层）

现有 Phase 1 实现不变：

- `Transport::new(config)` → Identity 初始化
- `Announce` 发送/接收 → 设备发现
- `TcpServer/TcpClient` → TCP Interface 接入
- `InterfaceManager.send()` → Announce 跨 Interface 传播
- `/mesh/ret/discovered` → 暴露发现结果

**增加**：
- Link 建立能力（E28 模式）：在配对过程中建立 Link，通过 Link 内部交换配对凭证

---

## 第二层：Reticulum 设备状态模型（状态层）

### 状态定义

| 状态 | Reticulum 语义 | UI 展示 |
|------|---------------|--------|
| **Discovered** | Announce 已收到，DeviceMetadata 已解析 | 设备列表中出现，灰色 |
| **Paired** | Link 建立 + PIN 验证通过 | 设备列表中绿色，标记为"已配对" |
| **Trusted** | 多次成功交换，identity 已缓存，自动重连 | 设备列表中蓝色，标记为"可信" |
| **Disconnected** | Announce 90 秒超时 / Link 断开 | 设备列表中灰色，标记"离线" |
| **Blocked** | 手动禁止连接 | 设备列表中红色，标记"已屏蔽" |

### 状态转换

```
Announce 收到
  → Discovered
      ↓ PIN 验证通过
  → Paired
      ↓ 多次成功交换
  → Trusted
      ↑ ↓ 断开/重连
      ↓ 90s 无 Announce
  → Disconnected
      ↓ 手动操作
  → Blocked
```

---

## 第三层：应用授权层（授权层）

### PIN 配对的角色

PIN 不在 Transport 层，不在 Link 层。它在应用层充当**人的在场证明**：

```
1. 设备 A 生成 6 位 PIN → 展示在屏幕上
2. 设备 B 的用户看到 PIN → 在外心 UI 中输入
3. 设备 B 通过 Reticulum Link（已建立）发送 PIN 到设备 A
4. 设备 A 验证 PIN → 配对完成
5. 此后双方通过 Link 加密通道交换数据
```

**PIN 不在 Transport 层**：Transport 负责建立 Link，不负责验证 PIN。
**PIN 不在 Link 层**：Link 层只负责加密的字节管道。

### per-peer 细粒度控制

配对完成后，外心软件维持自己的 per-peer 权限表：

| 权限 | 默认值 | 说明 |
|------|--------|------|
| 同步 EventLog | ✅ | 事件日志双向同步 |
| 同步 Task | ✅ | 任务双向同步 |
| 同步 TimeBlock | ✅ | 时间块双向同步 |
| 远程 Agent 调用 | ❌ | 允许对方调用本端 Agent |
| 配置写入 | ❌ | 允许对方修改本端配置 |

这些权限与 Reticulum 无关——它们是外心自己的授权决策。

---

## 与现有配对系统的关系

### 保留的部分

- `pairing.rs` 的 PIN 生成逻辑（6 位随机，100000-999999）
- 5 分钟 TTL，one-shot session
- 错误 PIN 立即销毁 session（anti-brute-force）

### 替换的部分

| 当前做法 | 新做法 |
|---------|--------|
| PIN 验证后生成 HTTP Bearer token | PIN 验证后通过 Link 确认配对状态 |
| 后续通信靠 HTTP Header 验证 | 后续通信靠 Link 加密通道 |
| `/mesh/pairing/initiate` HTTP 端点 | 通过 Announce 或 Link 触发配对 |
| `/mesh/pairing/respond` HTTP 端点 | 通过 Link 交换配对消息 |

---

## 未覆盖的场景（Phase 3+）

- **批量配对**：一台设备与多个设备依次配对的流程
- **配对撤销**：在已配对后手动取消配对并从对方 peer 列表中移除
- **远程配对**：跨局域网时通过 relay 节点转发配对请求（依赖 ECS 能力）
- **自动信任**：同一用户的设备自动进入 Trusted 状态（依赖档案身份）

---

## 验证

### Phase 2 验收标准

1. 双实例通过 Reticulum Link 完成 PIN 配对（不经过 HTTP）
2. 配对后双方进入 `Paired` 状态
3. UI 展示 Discovered/Paired/Disconnected 三态
4. 断开后 90 秒进入 `Disconnected`，Announce 恢复后回到之前的状态
5. 错误 PIN 验证失败，session 销毁

### 测试方法

```bash
# 实例 A
EXOMIND_RET_MESH=1 bun run tauri:manager -- start --name test-a

# 实例 B
EXOMIND_RET_MESH=1 RET_MESH_SEED=127.0.0.1:{A_TCP_PORT} bun run tauri:manager -- start --name test-b

# 验证发现
curl http://localhost:{A_RT}/mesh/ret/discovered

# 发起配对（流程待定）
```
