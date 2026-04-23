# Paired RT Model Phase 1 Design

> 日期：2026-04-24  
> 状态：draft  
> 关联 issue：[#938](https://github.com/exomind-team/exomind/issues/938)、[#906](https://github.com/exomind-team/exomind/issues/906)

## 1. 背景

当前软件已经开始承载三类“已配对 RT”上层能力：

1. 自动配对 / 自动同步总开关
2. 单设备暂停 / 恢复连通性
3. 备注 / 别名 / 删除已配对 RT

但这些能力当前都还建立在旧 `confirmed_peer + host store` 语义之上。

这会带来一个根问题：

- 系统里还没有一个独立、稳定、可治理的 **paired RT identity truth（已配对 RT 身份真值）**

当前现实更接近：

- `confirmed_peer`
  - 同时承担了身份、连接、UI 展示、backfill 候选、自动配对候选等多个角色
- `agent_runtime_hosts_v1`
  - 同时承担了 host cache 与 paired relationship 的事实来源

所以一旦继续在这套旧模型上叠“删除 / 别名 / 开关”功能，边界会继续互相污染。

现况归纳见：

- [docs/analysis/2026-04-24-paired-rt-model-current-state-summary.md](../analysis/2026-04-24-paired-rt-model-current-state-summary.md)

## 2. Phase 1 目标

Phase 1 只解决基础模型问题，不扩散。

本阶段要完成的是：

1. 给“已配对 RT”定义独立 truth
2. 把 truth 的存储归属固定下来
3. 明确 truth 与旧 host projection 的关系
4. 明确迁移方式
5. 停掉当前两种破坏性旧行为

本阶段不要求：

1. 一次性迁完全部运行时读侧消费者
2. 直接实现备注 / 删除 UI
3. 直接定义最终 delete / unpair / disconnect 产品合同

## 3. 核心原则

### 3.1 身份层与连接层必须拆开

必须显式区分两层：

1. **paired RT truth**
   - 回答“它是谁”
2. **connection path**
   - 回答“当前怎么连到它”

`host / port / dial address / manualOverride / lastSuccessfulDialAddress` 都属于连接层，不再直接代表 paired RT 身份本体。

### 3.2 paired RT truth 首版固定为 RT-local

Phase 1 的 truth 固定为：

1. **RT-local**
2. **跨档案可见**
3. **不跨 RT 同步**

原因：

1. 它描述的是“当前 RT 认为自己与哪些 RT 已建立配对关系”
2. 这不是 archive 业务域对象
3. 这也不是应该跨 RT 自动扩散的共享对象

### 3.3 存储归属固定为 Runtime Config `scope=device`

paired RT truth 的首版存储家固定为：

- Runtime Config `scope=device`

原因：

1. 后端已经具备 `scope=device`
2. 这层语义属于 RT / device 级关系状态
3. 它不应继续落在 `scope=user`
4. 它也不应先提升成 archive-scoped canonical contract

### 3.4 `agent_runtime_hosts_v1` 退位为 compat projection

Phase 1 后：

- `agent_runtime_hosts_v1`
  - 不是 paired RT truth
  - 只是 **compatibility materialized projection**

它保留的目的只有三个：

1. 兼容旧 UI
2. 兼容旧 service
3. 给暂未迁移的运行时读侧消费者提供稳定输入

### 3.5 迁移采用 lazy migration

Phase 1 不做大爆炸迁移，也不要求用户手工清理。

迁移方式固定为：

- **automatic lazy migration**

原则：

1. 只接管当前 `confirmed_peer`
2. 无法可靠解析 `peerId` 的旧记录继续留在 legacy fallback
3. 不为这类 legacy fallback 加特殊产品标记

### 3.6 Phase 1 只处理两类破坏性旧行为

本阶段必须先停掉：

1. live mesh 临时缺席时自动 prune `confirmed_peer`
2. 通用 `removeHost()` 继续承载“删除已配对 RT”的产品语义

其它运行时读侧消费者先不强行迁完。

## 4. 设计边界

### 4.1 要做

1. 定义 paired RT truth
2. 定义 connection path 层
3. 明确 truth 的 device-scope 存储归属
4. 明确 `agent_runtime_hosts_v1` 的 compat projection 身份
5. 明确 lazy migration / legacy fallback 规则
6. 停掉破坏性 prune / remove 旧语义

### 4.2 不做

1. 不改 Rust mesh API
2. 不把 external runtime 支持并入本阶段
3. 不在本阶段定义 archive-level pairing isolation
4. 不在本阶段定义最终 delete / unpair / disconnect 全合同
5. 不在本阶段实现备注 / 别名 / 删除 UI
6. 不在本阶段迁完全部 backfill / pairing / recovery 读侧消费者

## 5. 关键设计

### 5.1 paired RT truth 的语义

paired RT truth 描述的是：

- “本 RT 当前认定自己与哪些 RT 建立了持久已配对关系”

它不直接承载：

1. 当前连不连得上
2. 当前用哪个 IP / host / port 拨号
3. 当前 UI 是否展示为在线
4. 当前是否参与 backfill

这些都属于 truth 之外的派生态或连接态。

### 5.2 connection path 的语义

connection path 描述的是：

1. advertised address
2. dial address
3. manual override
4. last successful dial address

这层语义允许频繁变化。

它与 paired RT truth 的关系应是：

- “某个 paired RT 当前有哪些可用连接方式”

而不是：

- “连接方式本身就是 paired RT 身份”

### 5.3 compat projection 的要求

Phase 1 的 compat projection 至少要满足：

1. 继续产出 `RuntimeHostRecord`
2. 继续兼容当前 UI / service
3. 保留旧 `RuntimeHostRecord.id`
4. 在 lazy reconciliation 时物化重写

它不应再拥有反向塑造 truth 的权力。

### 5.4 运行时消费者的 Phase 1 边界

Phase 1 采用：

- **foundation first, consumer later**

因此运行时读侧消费者分两类。

#### 本阶段必须处理

1. `runtime-mesh-host-sync` 的 stale prune
2. `removeHost()` 被误用为 delete paired RT

#### 本阶段暂留 compat projection

1. `rt-domain-backfill`
2. `runtimeManager.ensureConfirmedPeerPair`
3. `runtime-mesh-sync`
4. `PeerPairingDialog`
5. 其它仍以 `confirmed_peer` 做候选筛选的读侧逻辑

这些逻辑在 Phase 1 中可以继续吃 compat projection，但文档必须明确它们只是过渡消费者。

## 6. 与现有 issue 的关系

### `#906`

- 上位 umbrella
- `#938` 是它在“配对 / 同步治理”方向上的基础模型子问题

### `#884`

- 承接 paired RT truth 之上的上层元数据 / 删除产品能力
- 不再承接 truth 本体如何建模

### `#788`

- 提供 `scope=device` 的基础设施
- 但不等于 paired RT 模型本身

### `#936 / #937`

- 已证明 RT-local 的同步治理开关是可行的
- 但它们仍建立在旧 projection 语义上

### `#868`

- 恢复性同步仍直接受 `confirmed_peer` 候选集合影响
- 与本题存在直接耦合
- 但不在本阶段一次性并掉

## 7. 验收口径

Phase 1 收口后，至少要满足：

1. paired RT truth 的语义和存储归属被写成合同
2. truth 明确固定为 Runtime Config `scope=device`
3. `agent_runtime_hosts_v1` 明确退位为 compat projection
4. lazy migration / legacy fallback 边界明确
5. live mesh 暂时缺席不会再自动删掉 paired relationship
6. `removeHost()` 不再继续承载“删除已配对 RT”的产品语义
7. 运行时其它读侧消费者仍留在 compat projection 的事实被明确写清，而不是暗含在代码里

## 8. 下一步

更合理的后续顺序是：

1. 先基于本设计把 `#938` 的实现边界固定
2. 再细化 `#884`
3. 再细化 `#868` 与其它读侧消费者迁移
4. 最后再讨论 archive-level pairing isolation

顺序不应反过来。
