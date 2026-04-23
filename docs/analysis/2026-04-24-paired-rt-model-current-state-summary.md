# Paired RT 基础模型现况总结

> 日期：2026-04-24  
> 范围：基于当前 `dev` 代码与 GitHub issue 现状，对“paired RT（已配对 RT）基础模型”做一次现况归纳与边界收口。

## 1. 一句话结论

当前真正缺的，不是“再加一个删除按钮”或“再补一个同步开关”，而是：

- **已配对 RT 需要独立身份真值**

如果这条真值不先成立，后续这些功能都会继续互相污染：

1. 删除本地配对
2. 暂停 / 恢复某个已配对 RT
3. 备注 / 别名
4. 恢复性同步候选筛选
5. 设备网络中的“已配对”产品语义

因此，这轮已把它从上层产品 issue 中单独拆出，作为 [#938](https://github.com/exomind-team/exomind/issues/938) 追踪，并挂到 [#906](https://github.com/exomind-team/exomind/issues/906) 之下。

## 2. 为什么会显得越来越复杂

问题本身其实很简单：

- 用户要的，是“已配对 RT”能被当成一个稳定对象来治理。

之所以一查就变复杂，是因为当前代码把四层东西揉在了一起：

1. **身份层**
   - “它是谁”
2. **连接层**
   - “当前通过什么地址 / 路径能连到它”
3. **运行时消费者筛选层**
   - “哪些 peer 参与 backfill / pairing / recovery”
4. **兼容投影视图层**
   - “当前 UI 和 service 还在吃的 host store / confirmed peer 语义”

换句话说，当前 `confirmed_peer` 不是单纯的“已配对关系”，而是：

- host cache
- mesh peer 状态
- dial address
- runtime 候选集合
- UI 展示态

的混合物。

所以只要继续在这个对象上叠“删除 / 别名 / 开关”，就会不断碰到边界错位。

## 3. 当前最关键的事实

### 3.1 Runtime Config 后端已经具备 `scope=device`

当前 `dev`（`a056019dbc76`）里，后端并不是没有设备级配置能力：

- [crates/exomind-runtime/src/config/types.rs](../../crates/exomind-runtime/src/config/types.rs)
- [crates/exomind-runtime/src/routes/config.rs](../../crates/exomind-runtime/src/routes/config.rs)

这里已经有：

1. `USER_CONFIG_SCOPE`
2. `DEVICE_CONFIG_SCOPE`
3. `GET /config`
4. `PUT /config/:key`
5. `DELETE /config/:key`

也就是说，**paired RT truth 的后端存储家已经存在**。

### 3.2 前端仍把 paired 关系挂在 `agent_runtime_hosts_v1`

当前前端没有真正把 paired 关系迁进 device-scoped truth：

- [src/config/runtime-config-adapter.ts](../../src/config/runtime-config-adapter.ts)
- [src/lib/services/runtime-host.service.ts](../../src/lib/services/runtime-host.service.ts)

现状是：

1. Runtime Config adapter 默认 scope 仍固定为 `user`
2. `agent_runtime_hosts_v1` 仍被当作前端导入白名单
3. host store 仍是 paired 关系的现实承载物

因此，paired 关系当前还不是一个独立真值对象，而是旧 host 缓存的一部分。

### 3.3 当前存在两个破坏性旧行为

#### A. live mesh 暂时缺席会自动清退 `confirmed_peer`

关键路径：

- [src/lib/services/runtime-mesh-host-sync.service.ts](../../src/lib/services/runtime-mesh-host-sync.service.ts)

当前行为是：

1. 一旦本地拿到非空 mesh peer 集合
2. 某个 `confirmed_peer` 不在当前 active 集合里
3. 就会被当成 stale host 清掉

这说明当前“已配对关系”还在被当作 live mesh 视图的派生物，而不是稳定身份真值。

#### B. `removeHost()` 仍是通用 host 删除

关键路径：

- [src/lib/services/runtime-host.service.ts](../../src/lib/services/runtime-host.service.ts)
- [src/services/runtime-manager.ts](../../src/services/runtime-manager.ts)

当前 `removeHost()` 做的只是：

1. 按本地记录 id 删除 host 记录

它没有回答：

1. 删除的是身份关系？
2. 删除的是连接路径？
3. 删除的是 UI 缓存？
4. 删除的是 mesh peer？

所以它不能继续承载“删除已配对 RT”的产品语义。

### 3.4 很多运行时消费者还直接吃 `confirmed_peer`

关键路径：

- [src/lib/services/rt-domain-backfill.service.ts](../../src/lib/services/rt-domain-backfill.service.ts)
- [src/services/runtime-manager.ts](../../src/services/runtime-manager.ts)
- [src/lib/services/runtime-mesh-sync.service.ts](../../src/lib/services/runtime-mesh-sync.service.ts)
- [src/ui/app/components/PeerPairingDialog.tsx](../../src/ui/app/components/PeerPairingDialog.tsx)
- [src/lib/utils/runtime-host-address.ts](../../src/lib/utils/runtime-host-address.ts)

这些位置仍在直接使用：

- `trustState === 'confirmed_peer'`

来做：

1. backfill 候选筛选
2. 自动 `ensurePeerPair`
3. pairing adoption
4. mesh-only peer 判断

这说明当前系统里大量运行时逻辑还在把 compat projection 当事实来源。

## 4. 当前应该收口成什么原则

这轮已收口的原则如下。

### 4.1 paired RT 必须有独立身份真值

它回答的是：

- “这个已配对 RT 是谁”

而不是：

- “当前怎么连到它”

### 4.2 身份层与连接层必须拆开

建议明确两层：

1. **paired RT truth**
   - 身份 / 关系层
2. **connection path**
   - host / port / dial address / manual override / last successful dial

连接方式可以变化，但不应导致身份对象跟着消失或重建。

### 4.3 首版真值固定为 RT-local / device-scoped

首版应固定为：

1. **RT-local**
2. **跨档案可见**
3. **不跨 RT 同步**

存储家固定为：

- Runtime Config `scope=device`

### 4.4 `agent_runtime_hosts_v1` 只保留为 compat projection

这条 store 不能再被当成 paired truth。

它更合理的定位是：

1. 兼容旧 UI / service 的物化投影
2. 供当前运行时读侧消费者暂时继续消费
3. 等基础模型稳定后再逐步退位

### 4.5 Phase 1 只修基础模型，不一次性迁完全部读侧

这轮不应该膨胀成“全同步系统重构”。

Phase 1 更合理的收口是：

1. paired truth 定义
2. `scope=device` 存储归属
3. lazy migration
4. compat projection 合同
5. 停掉破坏性的 prune / remove 旧语义

而下面这些可以后置：

1. backfill / pairing / recovery 读侧全量迁移
2. 删除 / unpair / disconnect 的最终产品合同
3. archive-level pairing isolation

## 5. 与当前 open issue 的关系

### 5.1 `#906`

- 角色：上位 umbrella
- 当前含义：paired RT 基础模型现在已经是搬迁式重构在“同步控制 / 配对治理”方向上的一个明确子问题

### 5.2 `#938`

- 角色：基础模型主 issue
- 当前含义：专门承接 paired RT truth、`scope=device`、compat projection、prune/remove 旧语义退位

### 5.3 `#884`

- 角色：上层产品能力
- 当前含义：应建立在 paired RT truth 之上
- 不再承担：身份真值本身如何建模

### 5.4 `#936 / #937`

- 角色：已完成的同步控制能力
- 当前含义：它们已经证明“RT-local 的控制策略”是可行的
- 但它们没有解决：paired RT 身份真值是什么

### 5.5 `#788`

- 角色：设备级 Runtime Config 基础设施
- 当前含义：它提供了 paired RT truth 的后端存储方向
- 但它本身不等于 paired RT 模型

### 5.6 `#868`

- 角色：恢复性同步问题
- 当前含义：它仍受 `confirmed_peer` 候选集合影响
- 因此和 paired RT truth 存在直接耦合，但不应在基础模型 issue 里一次性并掉

## 6. 当前最合理的下一步

当前最合理的顺序不是继续扩线，而是：

1. 先把 `#938` 这条基础模型线收口
2. 再回头细化：
   - `#884` 的备注 / 别名 / 删除
   - `#868` 的恢复候选集合
   - 更后面的 archive-level pairing isolation

换句话说：

- **先回答“paired RT 是什么”**
- 再回答“能对它做什么”

## 7. 本文档用途

这份文档只承担两件事：

1. 解释为什么 paired RT 这条线会从上层功能问题里单独拆出来
2. 给后续设计 / issue / 实现提供一个现况锚点

它不是最终设计稿，也不是实现计划；真正的实现 contract 应继续沉淀到：

1. [#938](https://github.com/exomind-team/exomind/issues/938)
2. `#906` 的后续迁移收口
