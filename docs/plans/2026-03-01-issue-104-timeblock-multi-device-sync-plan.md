# Issue #104 行动方案（系统分析版）

- Issue: `#104 多设备同步时间块状态`
- 分支：`feature/issue-104-analysis-kickoff`
- 分析日期：`2026-03-01`
- 当前状态：Issue 仍为 `OPEN`（最近更新：`2026-02-28`）

---

## 1. 背景与目标

`#104` 的核心不是“把时间块历史同步”这么单一，而是要保证**多设备对“进行中时间块”看到同一真实状态**，包括：

1. 是否在进行/暂停；
2. 正计时/倒计时的当前值；
3. 软结束/硬结束相关状态（`actionEndedAt`、`feedbackStartedAt` 等）；
4. 在任一设备操作后，其他设备 UI 能及时跟上。

---

## 2. 当前进展盘点（截至 2026-03-01）

### 2.1 Issue 讨论结论

Issue 评论已经形成一致认知：

1. 事件（`block_start/end/pause/resume/feedback`）已通过 EventStorage 同步；
2. 但 `active_block` 与 `time_blocks` 仍存在“非统一来源”的问题；
3. 方案方向不是纯 A 或纯 B，而是 **A+B 结合**：
   - A：历史/统计尽量从事件重建（减少重复状态）；
   - B：进行中状态要有独立可同步载体（保证实时一致）。

### 2.2 已有实现尝试

已有草稿 PR：`#300 feat: 多设备同步时间块状态 (#104)`（`DRAFT`，未合并）。

PR #300 主要做了：

1. 新增 `src/lib/storage/active-block-storage.ts`（PouchDB 存 active block）；
2. `timeblock.service.ts` 改为读写 `ActiveBlockStorage`；
3. 两个 UI 组件尝试 mount 时启动 `startSync/stopSync`；
4. 新增存储层单测与“active-block-sync”测试文件。

### 2.3 与当前 `dev` 的关系

该分支明显落后 `dev`（`dev...feature/issue-104-active-block-sync = 24/8`，公共基线在 `2026-02-28` 的较早提交）。  
直接合并风险高，会引入大量与 #104 无关的冲突与回退风险。

---

## 3. 现状根因（基于 `dev` 代码）

当前 `dev` 的关键事实：

1. `TimeBlockService` 仍将 `active_block`、`time_blocks` 写入 `env.storage`（键：`active_block`/`time_blocks`）；
2. `EventStorage` 已是 PouchDB 并有同步链路；
3. `TimeBlockWidget` / `FocusTimerWidget` 仅在加载时 `loadActiveBlock()`，没有真正消费 `onBlockChange` 订阅；
4. `onBlockChange` 目前只在 service 内实现，生产代码未接入监听。

结论：现在是“可刷新恢复、不可多端实时一致”的结构。

---

## 4. 对 PR #300 的系统评估（保留与重做边界）

### 4.1 可复用思路

1. “Active Block 独立存储层”方向正确；
2. `startSync/stopSync` 接口方向可保留；
3. 存储层与 E2E 的测试意识是加分项。

### 4.2 必须重做的问题

1. **同步生命周期放在组件层**：两个组件各自 start/stop，会互相抢占；
2. **远端变更未打通到 UI**：即使存储同步，UI 也不自动更新；
3. **登录状态变化未驱动重连**：只在 mount 时读一次登录态；
4. **存储层稳定性不足**：数据库命名/冲突处理/错误处理均需加强；
5. **分支陈旧**：建议不在 PR #300 上继续叠加开发。

---

## 5. 目标方案（本次建议）

采用“**事件为历史真相 + ActiveBlock 为运行态真相**”双轨方案：

1. `TimeBlockHistory`（已完成块列表）优先从事件重建，逐步淡出 `time_blocks` 持久键；
2. `ActiveBlockState`（进行中状态）使用专门同步存储（PouchDB 文档）；
3. 同步生命周期统一下沉到 service/manager，不放在 UI 组件；
4. UI 只订阅统一状态流，不直接管理 replication；
5. 任何端修改 active block，其他端在订阅回调中一致更新。

---

## 6. 实施拆解（按阶段）

## Phase 0：架构收敛（半天）

1. 明确 ActiveBlock 文档 schema（字段、版本、兼容策略）；
2. 定义 DB 命名规范（用户名标准化、非法字符处理）；
3. 定义冲突策略：`updatedAt` + 业务字段一致性规则；
4. 明确 service 与 UI 的职责边界（谁负责 start/stop sync，谁只消费状态）。

**产出**：轻量 ADR/设计说明 + 字段契约。

## Phase 1：核心实现（1~2 天）

1. 新增/重构 `ActiveBlockStorage`（不依赖浏览器环境，支持 Node 测试）；
2. `TimeBlockService` 接入 active block 同步，并统一管理订阅与同步生命周期；
3. 提供统一事件：`onBlockChange` 包含本地写入与远端变更；
4. 处理登录用户切换时的实例切换与清理。

**验收**：双设备同账号，任一端开始/暂停/恢复/结束，另一端自动更新。

## Phase 2：UI 接入（0.5~1 天）

1. `TimeBlockWidget` 与 `FocusTimerWidget` 改为订阅 service；
2. 去掉组件各自管理 sync 的逻辑；
3. 统一“远端更新覆盖本地 UI 状态”的策略（避免计时器漂移）。

**验收**：两个 UI 变体行为一致，不因组件卸载导致全局同步被停掉。

## Phase 3：历史数据收敛（可并行/后续）

1. 评估 `time_blocks` 从 `block_feedback` 重建的可行性；
2. 保留兼容读取，新增“事件重建优先”路径；
3. 逐步迁移并清理旧存储键。

**验收**：历史列表跨设备一致，且无重复来源冲突。

---

## 7. 测试与验收链路

## 7.1 单测（必须）

1. `ActiveBlockStorage`：
   - 文档写入/读取/删除；
   - 用户名规范化后的 DB 名称；
   - 冲突处理与重试；
   - 非浏览器环境兼容（无 `localStorage`）。
2. `TimeBlockService`：
   - 远端变更能触发 `onBlockChange`；
   - 登录切换后不会写入旧用户库；
   - 组件并发订阅/取消不影响同步核心。

## 7.2 E2E（必须）

新增 issue 专用 Playwright 配置（独立端口）并覆盖：

1. A 端开始块 → B 端出现运行态；
2. A 端暂停/恢复 → B 端实时切换；
3. A 端结束并进入反馈 → B 端清空 active block；
4. 登录后才开启同步（覆盖“先开页面后登录”场景）。

---

## 8. 风险与防护

1. **冲突风暴风险**：`elapsed` 高频写入可能冲突频繁；需要节流 + 冲突合并；
2. **生命周期竞争**：多个组件同时存在时禁止重复 start/stop 互相打断；
3. **用户名合法性**：必须统一 DB 名称规范化，避免非法库名导致同步失效；
4. **回归风险**：保留原有 TimeBlock 行为测试，先补失败测试再改实现。

---

## 9. 执行顺序建议（本分支）

1. 先提交“设计与测试骨架”PR（失败测试先落地）；
2. 再提交“service + storage 核心改造”PR；
3. 最后提交“UI 接入 + E2E”PR；
4. 每步都以 `dev` 最新为基线 rebase，避免重演 PR #300 的陈旧分支问题。

---

## 10. 本轮结论

`#104` 不是“补一个存储类”即可完成。  
要达成可交付标准，必须同步解决：**数据源边界、同步生命周期、远端变更推送到 UI、冲突处理、测试闭环**。  

建议从当前新分支直接重开实现，不在 PR #300 继续叠加。
