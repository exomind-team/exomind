# 同步服务器统一数据架构（讨论稿）

- 日期：`2026-03-01`
- 关联：`#104`
- 目标：同步架构不再局限于事件日志，支持通用数据域扩展

---

## 1. 结论先行

同步系统采用 **“每用户一个逻辑数据空间 + 多数据域文档”**：

1. 远端按用户隔离（用户维度的数据空间）；
2. 空间内用 `docType` 区分数据域（event / active_block / config / task ...）；
3. 统一复制通道，按数据域提供仓储接口；
4. #104 的 `active_block` 先作为首个“非事件域”落地。

---

## 2. 数据域模型（Storage）

## 2.1 统一文档包络

每条可同步文档统一携带：

- `docType`: 数据域类型（如 `event`、`active_block`）
- `userId`: 所属用户
- `updatedAt`: 冲突裁决主字段
- `deviceId`: 同时更新时的次级裁决字段
- `schemaVersion`: 向前兼容

## 2.2 推荐首批数据域

1. `event`：事件日志（已存在）
2. `active_block`：进行中时间块（#104 重点）
3. `config`：用户配置（已有同步入口）
4. `task`：任务（后续）

## 2.3 冲突策略

1. 默认：`updatedAt` 新者胜（LWW）；
2. 并列：按 `deviceId` 稳定排序；
3. 业务特例：`active_block` 增加状态优先级（例如 `ended > paused > running`）；
4. 冲突保留可观测信息（便于后续排障）。

---

## 3. UI 边界（UI）

1. UI 只消费 service 的“统一状态流”，不直接管理 replication；
2. UI 本地仅保留草稿态（输入框/开关）；
3. 同步生命周期（连接、重连、用户切换）放在 service/manager；
4. 多组件并存时，不能互相 stop 对方同步。

---

## 4. 开发策略（Dev）

1. 先把 #104 做成“通用架构第一块样板”；
2. 先测后改：先补失败测试，再实现；
3. 每阶段提供证据：
   - 单测
   - 关键 E2E（双端 A/B）
   - Web 开发服务器可启动
   - 构建通过

---

## 5. #104 落地映射

1. `active_block` 从本地 `env.storage` 切到可同步存储；
2. `TimeBlockService` 统一发出变更通知（含远端变更）；
3. `TimeBlockWidget` / `FocusTimerWidget` 订阅 service；
4. 用户登录后自动启动同步，登出/切换账号正确清理。
