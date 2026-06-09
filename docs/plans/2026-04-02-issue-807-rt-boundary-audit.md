# Issue #807 RT Boundary Audit

> **状态**: Draft
> **所属阶段**: Phase 2.5（RT 边界清点）
> **所属 Epic**: [#807](https://github.com/exomind-team/exomind/issues/807)
> **相关 Issue**:
> - `#793` 无头外心——RT 成为完整核心
> - `#675` UI → RT 功能迁移清点
> - `#676` Feature API /act 路径

---

## 1. 这份文档要解决什么问题

这不是一份“马上把所有逻辑都迁去 RT”的实施文档。

它是第一份**边界盘点清单**，回答一个更基础的问题：

> 当前客户端里，哪些动作只是 UI 展示层的本地逻辑，哪些已经在走服务 / RT，哪些应该逐步从客户端迁到 RT？

如果没有这一步，后面会出现两个问题：

1. 一边做 UI 统一，一边把业务动作继续塞回页面里
2. `GUI / CLI / Voice` 说是不同客户端，实际上每个入口都自己带一份局部逻辑

所以这份文档的目标不是“立刻迁移”，而是先建立判断标准和第一批候选动作清单。

---

## 2. 判断标准

### 应该保留在客户端的逻辑

这些逻辑默认可以继续留在 UI / CLI / Voice：

- hover / focus / open / close
- draft（草稿态）
- 本地输入过程
- 纯展示排序
- 路由切换
- 纯视觉反馈和动画

### 应该逐步迁到 RT 的逻辑

这些逻辑不应长期只存在于客户端：

- 跨实体联动
- 跨状态推进
- 多对象编排
- 需要跨客户端一致的业务动作
- 需要持久化的动作结果
- 未来要被 `GUI / CLI / Voice` 共用的动作

一句话版：

> 客户端负责“怎么触发”，RT 负责“业务动作真正怎么执行、执行后状态如何变化”。

---

## 3. 第一批盘点对象

本轮先看高价值普通页面与正在进入统一化的一批页面：

- `src/ui/app/pages/NowPage.tsx`
- `src/ui/app/pages/TasksPage.tsx`
- `src/ui/app/pages/RemindersPage.tsx`
- `src/ui/app/pages/SettingsPage.tsx`
- `src/ui/app/pages/TaskDetailPage.tsx`

---

## 4. 候选动作清单

### A. `NowPage`

#### 当前动作

- 读取 / 记忆 tab 路由
- 切换 `focus / record / today`

#### 判断

这部分属于**客户端展示逻辑**，不应迁 RT。

原因：

- 它只影响页面视图
- 不构成业务动作真相
- 不需要被 CLI / Voice 复用

#### 结论

- **保留在客户端**

---

### B. `TasksPage`

#### 当前动作

- 快速创建任务 `createTask`
- 创建后按配置决定是否跳转详情页
- 本地草稿缓存

#### 判断

可拆成两部分：

1. **创建任务**
   这是业务动作，应由服务 / RT 承担。
2. **创建后跳转到哪里**
   这是客户端行为，应保留在客户端。
3. **草稿缓存**
   这是本地输入态，应保留在客户端。

#### 当前风险

如果未来 CLI / Voice 也要走“快速创建任务 + 后续动作”，那么“创建任务”后的编排就不能长期只写在页面里。

#### 结论

- `createTask`：**应确保走 RT / 服务能力**
- `navigate after create`：**保留客户端**
- `draft cache`：**保留客户端**

---

### C. `RemindersPage`

#### 当前动作

- `createReminder`
- `updateReminder`
- `completeReminder`
- 本地表单开关 / 编辑态 / 时间输入

#### 判断

这里也应拆层：

1. reminder 的 CRUD（增删改完成）
   属于业务动作，应由服务 / RT 承担。
2. dialog 开关、表单输入、当前 tab 切换
   属于客户端交互，应留在客户端。

#### 当前风险

如果以后 reminder 也要被 voice / CLI / Agent 触发，那么“提醒动作”必须有统一服务入口，而不是只在页面按钮上定义。

#### 结论

- reminder CRUD：**应走 RT / 服务**
- 表单与页面态：**保留客户端**

---

### D. `SettingsPage`

#### 当前动作

- 渲染 registry-driven settings
- 桌面 / 移动布局分发
- 部分配置读取使用 `invoke(...)`
- 各类 setting 的 `get / set / subscribe`

#### 判断

Settings 本身是“入口页”，不是业务动作编排页。
但设置项背后的 `set(...)` 行为要进一步区分：

1. **纯界面偏好**
   可保留客户端 / 平台侧存储。
2. **运行时目标、网络模式、关键行为开关**
   长期应有 RT / runtime config 统一真相。

#### 当前风险

Settings 是最容易把“暂时方便的本地存储”长期固化成架构的地方。

#### 结论

- 页面布局和渲染：**保留客户端**
- 关键系统配置：**逐步收口到 RT / runtime config**

---

### E. `TaskDetailPage`

#### 当前动作

已观察到的高风险动作：

- 开始任务计时 / 时间块
- 把任务追加到当前 active block
- 暂停 block 再跳转
- 依赖新增 / 删除 / 类型变更
- 描述保存
- route memory / sessionStorage

#### 判断

这里是本轮最高优先级的边界候选区，因为它已经明显超出“纯页面交互”：

1. **开始任务 / 启动时间块**
   这是跨对象业务动作，应逐步收口为 RT action。
2. **追加任务到当前 active block**
   这是多对象联动，应逐步收口为 RT action。
3. **依赖新增 / 删除 / 类型变更**
   这是任务图结构修改，应由 RT / 服务负责。
4. **描述保存**
   这是普通实体更新，由服务 / RT 负责。
5. **route memory / sessionStorage**
   这属于客户端导航记忆，应保留客户端。

#### 结论

- task/block/dependency 编排相关动作：**优先列入 RT 收口候选**
- 页面导航和临时记忆：**保留客户端**

---

## 5. 第一批应进入 RT 收口讨论的动作

基于这轮盘点，我建议第一批重点讨论下面这些动作是否进入 RT：

1. `start task focus / start block from task`
2. `append task to active block`
3. `pause current block with follow-up intent`
4. `mutate dependency graph`
5. `shared create task workflow`
6. `shared reminder workflow`

其中优先级最高的是：

- `TaskDetailPage` 里的任务 / 时间块 / 依赖联动

因为这些动作最像未来会被：

- GUI 按钮
- CLI 命令
- Voice 指令
- Agent 编排

共同复用的业务能力。

---

## 6. 这份文档现在不做什么

这轮不做：

- 不直接改 RT 代码
- 不定义完整 `/act` 端点协议
- 不承诺一次性完成迁移
- 不把所有页面全部盘点完

这轮只做：

- **先把候选动作和边界判断写清楚**

---

## 7. 下一步建议

Phase 2.5 的下一步我建议分两小步：

### Step 1

在 `#807` 或相关 issue 中明确：

- 第一批 RT 收口动作
- 哪些先只列清单
- 哪些要在本 PR 中补文档证据

### Step 2

单独开后续 issue 或关联 `#675 / #676 / #793`，把高优先级动作拉进 RT 路线。

推荐第一批：

- 任务详情页启动 / 追加 / 依赖图动作

---

## 8. 当前结论

现在可以明确说：

- 不是所有客户端逻辑都该进 RT
- 但 `TaskDetailPage` 一类页面里的复杂动作，确实已经到了必须系统性清点和收口的时候
- 如果不先做这份边界盘点，后续 UI 统一很可能会把旧问题重新包装后继续留下来
