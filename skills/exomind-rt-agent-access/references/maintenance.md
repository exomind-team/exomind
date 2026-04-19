> 最后更新：`2026-04-20` | 更新者：`Codex` | 更新内容概要：`记录 await 自然语言到参数映射的补充维护，覆盖当前时间块完成、任务完成、匿名域与 1 小时超时。`

# Maintenance

## 何时读取

- 任务明确是“更新这个 skill”
- 你刚执行完一次 RT HTTP/curl 联调（无论走 `/act/*` 还是 raw fallback），准备把新经验回写进 skill
- 你怀疑某段 reference 已经过时，需要确认应该改主 `SKILL.md` 还是某个细分文档

## 执行后维护闭环

### Step 1：先做差异反思

在真正修改任何 skill 文件之前，先回答这组问题：

1. 本次执行实际参考了哪些章节或 reference？
2. 相比这些参考章节，本次执行出现了哪些新变化、例外、守卫条件或错误返回？
3. 哪些内容只是“现场参数不同”，哪些内容已经构成“文档过时”？
4. 差异属于 live 行为、代码实现、GitHub 决策，还是三者之间存在冲突？

如果这些问题没有回答清楚，不要直接改文档。

### Step 2：定位需要维护的文件

| 差异类型 | 应更新的文件 |
|----------|-------------|
| 主流程、风险边界、真相源优先级、什么时候触发 skill | `../SKILL.md` |
| 健康检查、版本、拓扑、profiles、signals、鉴权、PowerShell curl 约定 | `discovery-and-diagnostics.md` |
| eventlog 读写、raw watch、backup/import、清空、header 语义 | `eventlog.md` |
| tasks 查询、状态机、字段命名、取消/批量迁移、复制接口 | `tasks.md` |
| timeblocks 生命周期、guard、camelCase body、复制/导入行为 | `timeblocks.md` |
| references 装配方式、维护流程、维护记录 | `index.md` / `maintenance.md` |

原则：优先改最接近事实发生位置的文件，只有跨域规则变化才改主 `SKILL.md`。

### Step 3：核验差异是否真实

至少做下面三类核验中的两类；若是高风险契约变化，三类都做：

- live：`GET /health`、`GET /version`、实际 curl 请求/返回
- 代码：`crates/exomind-runtime/src/routes/*.rs`、相关 store / lib
- GitHub / 文档：相关 issue、PR、开发文档

如果 live 与代码冲突，要把冲突本身写进维护记录，而不是只写结论。

### Step 4：执行维护

- 更新被修改文件顶部的三项元数据：
  - `最后更新`
  - `更新者`
  - `更新内容概要`
- 必要时同步更新主 `SKILL.md` 的“最后更新日期 / 更新者 / 更新内容概要”
- 如果入口文档或仓库 docs 的链接需要调整，一并修正
- 删除已经重复且不再维护的旧文档，而不是留下第二份真源

### Step 5：复核

- `git diff --check`
- 重新阅读主 `SKILL.md`，确认它仍然是入口层，不是细节堆积
- 重新阅读被修改的 reference，确认新增内容已经放到最合适的文件
- 搜索旧路径/旧端点，确认没有残留误导性引用

## 最小复核清单

- `GET /health` 与 `GET /version` 是否仍然分离
- `DELETE /eventlog` 是否仍为清空端点
- `eventlog` 是否仍以 `user_id` 为主作用域参数
- `tasks` / `timeblocks` 是否仍接受 `profile_id` 与 `user_id` 双别名
- `timeblocks/end` 是否仍要求先 `stop`
- `/act/*` 是否新增新的默认外部入口，导致 raw 路由描述需要降级
- 当前已存在的 `/act/*` 默认入口列表是否仍准确；若新增动作，相关 raw reference 是否已经降级为 fallback 并补了跳转
- 当 `/act/*` 已存在对应动作时，主 `SKILL.md` 是否仍错误引导 Agent 默认去打 raw 路由
- 等待/监听默认是否已经切换到 `/act/await`，而不是误导到 raw `GET /eventlog/watch`
- 主 `SKILL.md` 是否仍保持入口层，而维护细节留在 references

## 维护记录格式

- 更新日期：`YYYY-MM-DD`
- 更新者：`人类姓名 / Agent 名称`
- 更新内容概要：`一句话说明覆盖了哪些文件或章节`
- 核验依据：`live 版本信息 + 代码文件/提交 + GitHub issue/PR/文档`

## 最近维护记录

- `2026-04-20` | 更新者：`Codex` | 更新内容概要：`补充 await 自然语言意图到参数映射，覆盖“当前时间块完成”“任务完成”“匿名域监听”“超时 1 小时”，并把这些口径下沉到 tasks/timeblocks references。` | 核验依据：`crates/exomind-runtime/src/agent_await.rs + docs/testing/2026-04-19-await-timeblock-experiment-summary.md + docs/development/runtime-external-access-contract.md`
- `2026-04-19` | 更新者：`Codex` | 更新内容概要：`在主 SKILL 与 timeblocks reference 中明确 timeblock_stopped=专注结束、raw block_end=stop 痕迹、timeblock_ended=反馈完成后的时间块完成，避免 Agent 将“时间块结束”与“时间块完成”混淆。` | 核验依据：`await 联测 live 结果 + crates/exomind-runtime/src/agent_await.rs + crates/exomind-runtime/src/routes/timeblocks.rs + docs/plans/2026-04-19-external-agent-await-api-plan.md`
- `2026-04-19` | 更新者：`Codex` | 更新内容概要：`收口“Agent 默认优先 /act/*，只有无对应动作时才回退 raw API”的入口规则，并把 index / tasks / timeblocks / eventlog references 全部标注为 raw fallback 或 act-first 跳转。` | 核验依据：`#676 + #930 + #931 + runtime-external-access-contract.md + today_planner.rs + agent_await.rs + routes/agent_await.rs + routes/eventlog.rs`
- `2026-04-19` | 更新者：`Codex` | 更新内容概要：`将独立 curl 手册剩余增量信息并入主 SKILL 的外部边界章节，补充当前 `/agents/*` 与 `/act/today-planner/*` 的精确端点列表，并删除 docs/development 下的重复 standalone 文档。` | 核验依据：`仓库全文搜索无反向引用 + 当前 skill references 结构 + 基线 e79ab61b`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`移除 skill 文档中对已删除 curl 手册文件名的残留提及，确认 skill 内只保留单一真源表述。` | 核验依据：`skill 目录全文搜索 + 当前工作区 skill 结构`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`将原 curl 手册内容重构到本 skill 的 references/ 中，主 SKILL 收口为入口层。` | 核验依据：`当前工作区文档结构 + 基线 a83404ad`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`建立“curl 实测偏差 -> 核验 -> 回写本 skill”的同步维护机制。` | 核验依据：`当前工作区文档结构`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`新增 references 索引与维护文档，并强制维护前先做执行后差异反思。` | 核验依据：`当前工作区代码 + 当前 skill 结构`
