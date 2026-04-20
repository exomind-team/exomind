# #934 实施计划：任务依赖图折叠状态汇总、统一恢复与区间收缩模型收口

## Summary

本计划服务于 [#934](https://github.com/exomind-team/exomind/issues/934)，目标不是只加一个按钮，而是把任务依赖图中两类“折叠”真相收口为可实现、可验收、可长期维护的一致模型：

1. **节点上下游折叠**：以节点为锚点的视图投影状态。
2. **区间收缩**：附着在终点节点上的区间收缩配置与其当前收起/展开状态。

这轮要完成三件事：

- 在控制面板终态过滤区下方新增“折叠状态”汇总块。
- 新增统一的 `取消折叠所有` 入口，恢复所有折叠态。
- 把区间收缩的内部状态模型从“全局扁平列表”收口为“按终点节点归组的配置”。

最终验收不只看单测和类型检查；功能完成后必须进入真实 Tauri 桌面窗口，用 Tauri MCP 跑一遍相关链路，确认问题在真窗中被解决。

## Status

- [x] 计划已同步到 GitHub issue `#934`
- [x] 代码实现已完成，并补上 reviewer 复核发现的四个缺口：
  - 折叠锚点节点个数 badge 不再被低优先级 badge 折叠逻辑吞掉
  - mixed payload 下区间状态归一化改为“新模型优先，旧模型兜底”
  - 已失效区间配置不会再污染折叠状态汇总，且不会在“首屏瞬时空列表、随后真实图到达”的路径里被误写回清空
  - stale / duplicate `dagVisibility` 锚点会先按当前图归一化，再参与汇总与持久化回写
  - browse 选中节点导致主控制面板隐藏时，详情面板仍保留全局折叠状态与 `取消折叠所有` 入口
- [x] 相关自动化验证已通过
- [x] Tauri MCP 真窗验收已完成（未登录档案 / anonymous scope）

说明：

- 本轮真窗为了稳定构造最小 DAG，采用“RT 真实任务 seed + runtime-backed DAG 偏好注入”的方式准备 persisted truth，再在桌面窗口里验证显示与恢复行为。
- 没有依赖 mock 数据，也没有直接改 SQLite；走的仍然是产品自身的 RT / 偏好代码路径。

---

## 当前真相

### 1. 控制面板现状

- 当前 [src/ui/app/components/TaskDagControlPanel.tsx](../../src/ui/app/components/TaskDagControlPanel.tsx) 在终态过滤区域只展示：
  - `弱化已结束 / 隐藏已结束 / 展示已结束`
  - `隐藏了 N 个进行中节点`
- 当前没有任何地方汇总：
  - 已折叠上游锚点数
  - 已折叠下游锚点数
  - 已收起区间数
- 当前也没有“一次性恢复所有折叠态”的入口。

### 2. 节点上下游折叠现状

- 节点折叠真相当前由 [src/ui/app/pages/TaskDagPage.tsx](../../src/ui/app/pages/TaskDagPage.tsx) 中的 `dagVisibility` 承载：
  - `collapsedUpstreamOf`
  - `collapsedDownstreamOf`
- 这是一种**锚点声明**，不是独立对象。
- 因此：
  - 节点“展开”本质上等于删除这一条锚点声明。
  - 节点“取消折叠所有”本质上等于清空两个锚点数组。

### 3. 区间收缩现状

- 当前区间收缩状态由：
  - [src/lib/task/task-dag-interval-collapse.ts](../../src/lib/task/task-dag-interval-collapse.ts)
  - [src/config/task-dag-preferences.ts](../../src/config/task-dag-preferences.ts)
  - [src/ui/app/pages/TaskDagPage.tsx](../../src/ui/app/pages/TaskDagPage.tsx)
  共同承载。
- 当前持久化结构是扁平 `intervals[]`，每项包含：
  - `startId`
  - `endId`
  - `collapsed`
- 当前测试已经明确一条重要 contract：
  - “展开区间”不等于删除区间定义。
  - 证据见 [tests/unit/ui/task-dag-page.issue394.test.tsx](../../tests/unit/ui/task-dag-page.issue394.test.tsx) 中 `can expand the interval without deleting its definition`。

### 4. 已锁定的产品语义

- **节点折叠不是独立对象**，只有锚点状态。
- **区间收缩也不应成为独立 truth object**，而应被理解为：
  - 终点节点上的一条或多条收缩配置。
- 区间收缩配置的物理归属也应改挂到终点节点，而不是继续以全局扁平列表作为主语义模型。
- 同一终点节点允许挂多个区间配置。
- 同一终点节点上的多个区间配置，顺序按**创建时间**固定，不额外计算内外层排序。
- 终点节点只继承**起点的外部入边**。
- 若区间内部存在边界外入边，则不应有合法区间收缩机会。

---

## 本轮固定决策

### A. 控制面板状态块

- 状态块位置固定：
  - 放在终态过滤区按钮行下方。
- 状态块零态固定：
  - 当三项计数都为 `0` 时，**隐藏整个状态块**。
- 状态块计数固定为三项并列：
  - `已折叠上游锚点数`
  - `已折叠下游锚点数`
  - `已收起区间数`
- 三项计数都基于**全局持久化真相**，不是当前过滤/搜索/聚焦后的可见图。

### B. `取消折叠所有`

- 作用范围固定为**全局持久化真相**。
- 行为固定为：
  - 清空 `collapsedUpstreamOf`
  - 清空 `collapsedDownstreamOf`
  - 将所有区间配置的 `collapsed` 统一设为 `false`
- 明确不做：
  - 不删除区间配置
  - 不影响搜索、标签过滤、聚焦、终态过滤等其他控制状态

### C. 节点锚点 badge 原则

这轮必须严格遵守并保留以下 invariant：

- **节点上下游折叠时，折叠锚点必须显示折叠节点个数 badge。**
- 这里的 badge 不是“当前锚点已折叠”标签本身，而是对外明确显示：
  - 该锚点当前折叠了多少节点
- 因此本轮不得为了做控制面板汇总或状态模型收口而破坏现有节点卡片上的折叠计数 badge 语义。
- 若实现状态模型调整后导致 badge 计数来源变化，必须同步修正并补测试。

### D. 区间状态模型

- 持久化主模型改为**按终点节点归组**。
- 语义目标结构可表达为：

```ts
type TaskDagIntervalCollapseState = {
  terminals: Record<string, Array<{
    startId: string;
    collapsed: boolean;
  }>>;
};
```

- 说明：
  - `Record` 的 key 是终点节点 `endId`
  - 数组顺序即创建顺序
  - `endId` 不再在每条配置中重复存储，因为它已由归组 key 表达

### E. 旧数据兼容

- 必须兼容当前本地已存在的 `intervals[]` 扁平结构。
- 读取老数据时：
  - 按 `endId` 分组
  - 保持原始顺序
  - 归一化为新结构
- 写回时：
  - 统一写新结构
- 不要求保留“双写”兼容，只要求读取老格式不丢状态。

### F. 区间删除边界

- 本轮**不**补“删除区间配置”入口。
- 本轮只保证：
  - “展开区间”是状态切换，不是删除配置
  - “取消折叠所有”是统一展开，不是删除配置

---

## 实施任务清单

### Phase 1：状态模型与持久化收口

- [x] 改写 `TaskDagIntervalCollapseState` 类型，主语义从 `intervals[]` 收口为 `terminals[endId][]`
- [x] 更新区间收缩状态归一化逻辑
- [x] 更新本地持久化读写逻辑
- [x] 加入老格式 `intervals[]` -> 新格式 `terminals{}` 的读取兼容
- [x] 保持创建顺序稳定，不做额外排序

重点文件：

- [src/lib/task/task-dag-interval-collapse.ts](../../src/lib/task/task-dag-interval-collapse.ts)
- [src/config/task-dag-preferences.ts](../../src/config/task-dag-preferences.ts)

### Phase 2：区间投影与页面操作改造

- [x] 更新 `resolvedExistingIntervals` 的来源，适配新状态结构
- [x] 更新区间投影函数的遍历入口，改为从终点分组展开配置
- [x] 更新 `handleSetIntervalCollapsed`
- [x] 更新 `handleToggleIntervalsForTerminal`
- [x] 更新创建区间后的写入逻辑
- [x] 新增统一的 `handleClearAllFoldedState`

行为要求：

- 节点折叠：删除锚点声明
- 区间收缩：保留终点配置，仅切换 `collapsed=false`

重点文件：

- [src/ui/app/pages/TaskDagPage.tsx](../../src/ui/app/pages/TaskDagPage.tsx)
- [src/lib/task/task-dag-interval-collapse.ts](../../src/lib/task/task-dag-interval-collapse.ts)

### Phase 3：控制面板折叠状态汇总

- [x] 为控制面板新增折叠状态 props
- [x] 在终态过滤区下方新增状态块
- [x] 状态块并列展示三项计数
- [x] 新增 `取消折叠所有` 按钮
- [x] 三项都为 0 时隐藏整个状态块
- [x] browse 选中节点时，详情面板镜像保留全局折叠状态与统一恢复入口
- [x] mobile detail drawer 同样保留镜像折叠状态与统一恢复入口

计数来源固定为：

- 上游锚点数 = **归一化后的** `collapsedUpstreamOf.length`
- 下游锚点数 = **归一化后的** `collapsedDownstreamOf.length`
- 已收起区间数 = 归一化后所有终点配置中 `collapsed === true` 的配置数

重点文件：

- [src/ui/app/components/TaskDagControlPanel.tsx](../../src/ui/app/components/TaskDagControlPanel.tsx)
- [src/ui/app/pages/TaskDagPage.tsx](../../src/ui/app/pages/TaskDagPage.tsx)

### Phase 4：节点锚点 badge 回归保护

- [x] 核查上下游折叠锚点 badge 当前计数来源
- [x] 保证节点卡片在折叠后仍显示被折叠节点个数
- [x] 若状态模型改造影响 badge 计数，修正其计数逻辑
- [x] 补回归测试，防止后续重构把该 badge 弄丢

重点文件：

- [src/ui/app/pages/TaskDagPage.tsx](../../src/ui/app/pages/TaskDagPage.tsx)
- 对应 DAG 节点相关测试

### Phase 5：自动化验证

- [x] 更新区间状态持久化单测
- [x] 更新区间投影单测
- [x] 更新/新增控制面板状态块单测
- [x] 更新/新增 `取消折叠所有` 行为测试
- [x] 更新/新增节点锚点 badge 回归测试
- [x] 运行相关 `vitest`
- [x] 运行 `tsc --noEmit`

### Phase 6：Tauri MCP 真窗验收

- [x] 启动或连接可用的 Tauri 桌面实例
- [x] 官方 `driver_session` 已稳定接管，无需退回 raw bridge
- [x] 在真实桌面窗口中完成关键验收链路

---

## 自动化测试计划

### 1. 持久化与迁移

- [ ] 老格式 `intervals[]` 读取后能正确归一化为终点分组结构
- [ ] 新格式写回后再次读取稳定
- [ ] 非法/重复区间配置在归一化后被过滤
- [ ] 同终点多个区间配置保持原创建顺序

建议测试文件：

- [tests/unit/config/task-dag-preferences.test.ts](../../tests/unit/config/task-dag-preferences.test.ts)
- [tests/unit/ui/task-dag-interval-collapse.issue501.test.ts](../../tests/unit/ui/task-dag-interval-collapse.issue501.test.ts)

### 2. 区间投影

- [ ] 收起区间后仍复用终点节点，不生成独立 truth node
- [ ] 展开区间后配置仍存在，只是 `collapsed=false`
- [ ] 多个终点配置共存时，投影结果稳定
- [ ] 展开外层/统一展开后，内层配置不丢失

### 3. 控制面板状态块

- [ ] 零态时不显示
- [ ] 存在节点折叠时显示正确锚点数
- [ ] 存在已收起区间时显示正确区间数
- [ ] 即便折叠内容因搜索/过滤暂不可见，状态块数字仍按全局真相显示

### 4. `取消折叠所有`

- [ ] 节点折叠数组被清空
- [ ] 所有区间配置变为 `collapsed=false`
- [ ] 区间配置本身不删除
- [ ] 搜索/标签/聚焦/终态过滤不受影响
- [ ] browse 选中节点导致主控制面板隐藏时，详情面板中仍可触发统一恢复

### 5. 节点锚点 badge

- [ ] 折叠上游锚点仍显示折叠节点数 badge
- [ ] 折叠下游锚点仍显示折叠节点数 badge
- [ ] 引入控制面板状态块后，不替代、不削弱节点级 badge

---

## Tauri MCP 真窗验收清单

本轮桌面验收目标不是只验证 DOM 是否存在，而是验证真实用户操作链已经闭环。

### 验收前准备

- [x] 按 [docs/development/tauri-mcp-windows-playbook.md](../development/tauri-mcp-windows-playbook.md) 确认当前实例真值
- [x] 优先连接可用 bridge；本轮官方 `driver_session` 已稳定接管
- [x] 打开 `/tasks/dag`

### 验收链路 1：节点折叠状态汇总

- [x] 在真窗里恢复包含“折叠上游/折叠下游” persisted truth 的最小 DAG
- [x] 确认控制面板终态过滤区下方出现折叠状态块
- [x] 确认状态块正确显示：
  - 上游锚点数
  - 下游锚点数
  - 已收起区间数

### 验收链路 2：节点锚点 badge

- [x] 真窗中恢复上游折叠态后，锚点节点显示折叠节点数 badge
- [x] 真窗中恢复下游折叠态后，锚点节点显示折叠节点数 badge
- [x] badge 计数与实际被折叠成员数一致

### 验收链路 3：区间收缩与统一恢复

- [x] 在真窗中恢复包含合法区间收缩的 persisted truth
- [x] 确认控制面板状态块中的区间数增加
- [x] 点击 `取消折叠所有`
- [x] 确认：
  - 所有上下游节点重新出现
  - 所有区间重新展开
  - 区间配置仍存在，可再次收起

### 验收链路 3.5：选中节点后的入口连续性

- [x] 在真窗中恢复包含上下游折叠与区间收缩的 persisted truth
- [x] 单击区间终点节点进入详情面板
- [x] 确认主控制面板因选中态收起后，详情面板中仍显示：
  - `全局折叠状态`
  - `取消折叠所有`
  - `上游 1 / 下游 1 / 区间 1`
- [x] 在详情面板中点击 `取消折叠所有`
- [x] 确认本地持久化变为：
  - `collapsedUpstreamOf = []`
  - `collapsedDownstreamOf = []`
  - 区间配置保留，但 `collapsed = false`

### 验收链路 4：跨状态切换恢复

- [x] 先恢复节点折叠和区间收缩 persisted truth
- [x] 切换搜索过滤，让部分折叠对象暂时不可见
- [x] 确认控制面板汇总仍显示全局真相
- [x] 点击 `取消折叠所有`
- [x] 确认可见性恢复后，全局折叠态已真正清空

证据：

- 搜索框在真窗里被设为 `INT_C` 后，画面只剩区间终点 `TMCP_ISSUE934_VERIFY_1776687086304_INT_C`，上下游锚点不再可见。
- 同时控制面板仍显示 `上游 1 / 下游 1 / 区间 1`，说明汇总按全局持久化真相而不是按当前画面可见节点计数。
- 在这个过滤态点击 `取消折叠所有` 后，汇总块立即消失，持久化状态变为：
  - `collapsedUpstreamOf = []`
  - `collapsedDownstreamOf = []`
  - 区间配置保留，但 `collapsed = false`
- 随后清空搜索词，真窗确认所有 marker 节点重新出现，说明“过滤态下清空折叠”作用的是全局真相，而不是只影响当前可见子图。

### 验收链路 5：刷新后恢复

- [x] 写入节点折叠与区间收缩 persisted truth
- [x] 刷新页面或重开 DAG 页面
- [x] 确认状态块数字恢复正确
- [x] 再点击 `取消折叠所有`
- [x] 确认刷新后仍能一次性恢复全部折叠态

证据：

- 以如下 persisted truth 为基线重载 DAG 页面：
  - `collapsedUpstreamOf = ['34e19c71-571e-494c-bf09-abeaf8a90bc2']`
  - `collapsedDownstreamOf = ['7764115d-4cb8-4e2f-a68f-c7af6fe5e3aa']`
  - `terminals['ba2414a0-5610-4fbd-97eb-44ffc3c440fe'] = [{ startId: '8f193a9e-b96f-49b2-b099-c2075e276393', collapsed: true }]`
- 刷新后真窗 accessibility snapshot 明确显示：
  - 折叠状态块 `上游 1 / 下游 1 / 区间 1`
  - 上游锚点 badge `+1 已折叠`
  - 下游锚点 badge `+1 下游已折叠`
  - 区间终点 badge `3 个节点`
- 点击 `取消折叠所有` 后，真窗确认：
  - 汇总块消失
  - `collapsedUpstreamOf = []`
  - `collapsedDownstreamOf = []`
  - 区间配置仍存在，但 `collapsed = false`
- 再次刷新后，汇总块仍保持消失，说明“刷新恢复”和“统一清空”两条持久化链已经闭环。
- 补充：在同一组 persisted truth 下，单击区间终点 `TMCP_ISSUE934_VERIFY_1776687086304_INT_C` 后，真窗详情面板明确显示：
  - `全局折叠状态`
  - `取消折叠所有`
  - `上游 1 / 下游 1 / 区间 1`
- 在详情面板里点击 `取消折叠所有` 后，真窗 accessibility snapshot 确认该区块消失，同时本地持久化变为：
  - `collapsedUpstreamOf = []`
  - `collapsedDownstreamOf = []`
  - `terminals['ba2414a0-5610-4fbd-97eb-44ffc3c440fe'][0].collapsed = false`

---

## 风险与复核点

### 风险 1：区间状态改模型后，旧数据失效

复核要求：

- 必须先用老格式样本跑单测
- 必须确认读取老数据不会丢现有区间定义

### 风险 2：控制面板统计与当前画布统计混淆

复核要求：

- 测试里必须明确区分“全局持久化真相”与“当前可见图”
- 状态块按全局真相，不能误跟着当前过滤结果归零

### 风险 3：节点锚点 badge 被控制面板汇总替代

复核要求：

- 必须保留节点卡片自身的折叠成员数 badge
- 控制面板状态块只是全局汇总，不得替代节点局部语义

### 风险 4：统一恢复误删区间配置

复核要求：

- `取消折叠所有` 后，本地持久化里仍应存在终点节点上的区间配置
- 只是 `collapsed` 统一变成 `false`

---

## 完成定义

本计划完成，必须同时满足：

- [x] Markdown 计划中的各实施任务完成
- [x] 相关单测与类型检查通过
- [x] 节点上下游折叠锚点 badge 原则未被破坏
- [x] 控制面板折叠状态块与统一恢复入口按全局真相工作
- [x] 真实 Tauri 桌面窗口验收通过
- [x] 最终复核一遍 diff、测试结果与真窗结果，确认实现与计划一致

## 本轮验收记录

- 自动化验证：
  - `npx tsc --noEmit`
  - `npx vitest run tests/unit/config/task-dag-preferences.test.ts tests/unit/ui/task-dag-interval-collapse.issue501.test.ts`
  - `npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx -t "shows fold summary counts and preserves node anchor badges for upstream/downstream collapses|keeps a global fold reset entry accessible in the detail panel when selection hides the main control panel|keeps fold-count badges visible even when dense titles suppress low-priority labels|keeps fold summary based on persisted truth even when search filtering hides the folded anchor|normalizes stale visibility anchors before computing fold summary counts|drops stale persisted interval state before computing the fold summary|does not wipe persisted fold state when the first task load is empty before the real graph arrives|shows interval members in the detail panel and can expand the interval without deleting its definition|clears all folded state by expanding intervals without deleting their definitions"`
  - `npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx -t "keeps a global fold reset entry accessible in the detail panel when selection hides the main control panel|keeps the mirrored fold reset entry available in the mobile detail drawer|clears all folded state by expanding intervals without deleting their definitions"`
- 真窗验收：
  - 受管实例 `issue934-dag-fold-verify` 已通过 `driver_session` 接管，bridge 端口 `9473`
  - 当前主窗口标题 `ExoMind [dev] [Web:1670 RT:4389]`，URL `http://localhost:1670/tasks/dag`
  - 本轮验收在未登录档案中完成：
    - 侧边栏显示 `未打开档案`
    - `localStorage['exomind:profile-session'] === null`
  - 在 `/tasks/dag` 真窗中确认折叠状态汇总显示 `上游 1 / 下游 1 / 区间 1`
  - 在真窗中确认节点锚点 badge 保持可见：
    - 上游锚点 `+1 已折叠`
    - 下游锚点 `+1 下游已折叠`
    - 区间终点 `3 个节点`
  - 在搜索词 `INT_C` 的过滤态下，真窗仍显示 `上游 1 / 下游 1 / 区间 1`
  - 点击 `取消折叠所有` 后，真窗确认：
    - 汇总块消失
    - `collapsedUpstreamOf = []`
    - `collapsedDownstreamOf = []`
    - 区间配置仍存在，但 `collapsed = false`
  - 在真窗中单击 `TMCP_ISSUE934_VERIFY_1776687086304_INT_C` 后，详情面板显示：
    - `全局折叠状态`
    - `取消折叠所有`
    - `上游 1 / 下游 1 / 区间 1`
  - 在详情面板中点击 `取消折叠所有` 后，真窗确认：
    - 详情面板中的 `全局折叠状态` 区块消失
    - `collapsedUpstreamOf = []`
    - `collapsedDownstreamOf = []`
    - 区间配置仍存在，但 `collapsed = false`
    - 原先被折叠隐藏的 `UP_A / UP_B / DOWN_A / DOWN_B / INT_A / INT_B / INT_C` 相关节点重新回到画布
    - 区间操作按钮从 `展开区间` 变回 `收起区间`
  - 清空搜索词并再次刷新后，所有 marker 节点保持展开，说明 persisted clear 结果已稳定落盘
- 补充说明：
  - 补跑 `npx vitest run tests/unit/ui/task-dag-page.issue394.test.tsx tests/unit/ui/task-dag-interval-collapse.issue501.test.ts tests/unit/config/task-dag-preferences.test.ts` 时，仍会命中一个与本 issue 无关的既有失败：`emits focus-hard drag session logs during touch drags in manual layout`
  - 因此本轮自动化结论以 `#934` 相关定向用例 + `tsc` 通过为准，不把该既有 page-suite 失败误归因到本轮折叠实现
