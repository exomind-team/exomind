> 最后更新：`2026-11-20` | 更新者：`Codex` | 更新内容概要：`记录 Beta monitor 的有界历史状态、JSON 响应预算与每 feed 页上限。`

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
| Beta 与旧 RT 分流、禁止跨协议回退 | `../SKILL.md` / `index.md` |
| 正式 Beta HTTP 权限、类型、分页、回执、原件及未实现能力 | `beta-agent-access.md` |
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

- 先确认协议：Beta reference 不继承旧 `/act/*`、slug、匿名域、旧 monitor 配置、token query 或 owner profiles 发现路线
- Beta 业务接口以 `crates/exomind-beta-host` 当前路由/权限和 Core 类型核对；区分源码检查、HTTP 实测与真实 Agent 验收，不把文档完成当 V16 通过
- Beta HTTP 未知回执为 404 `not_found`，Native Option 则可为 `null`，不得混用
- Beta `access/check`、本次有界 `wait` 与 JSON Agent bundle 的源码支持只在目标版本实际接线时可调用；不能把它们说成旧 `/act/await` 语义、产品目录导出或完整备份
- 本地代码、根接线 patch、Core lifecycle 依赖、installed candidate、HTTP 实测与外部 Agent 使用分别记账；没有 live 证据不得称为已验收
- 下列旧 RT 复核项只对明确指定的旧 Runtime 生效；Beta 不因它们存在便自动转向旧实例

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
- `2026-11-20` | 更新者：`Codex` | 更新内容概要：`补记个人 Skill 的独立真实调用证据。` | 核验依据：`独立 Luna 驱动、个人安装脚本与真实隔离 Core10 source Host，run 9d5739f3-0e06-497e-81c4-429cbd4cf475 exit0、cleanup true；同一 through=511 两批完整历史、4 件 SHA、AgentNote 查证与 changed Wait。首轮报告超输出预算的 run ffd20f0b-8217-416e-89bc-bffc50d9e87c 保留为驱动失败，不混为产品结果。没有系统剪贴板/候选/设备结论。`
- `2026-11-20` | 更新者：`Codex` | 更新内容概要：`收束生产 monitor adapter，按目标 block ID 区分结束动作与反馈完成；同步个人 exomind-monitor 的 Beta 分流与 bundled adapter。` | 核验依据：`19 项 SDK 回归全部通过；实际 HTTP run 42b75def-b237-4bf3-bd3b-9ea674edd94d exit 0、cleanup confirmed，使用当前生产脚本、FileStateStore 和独立 Core10 source Host，覆盖 105 capture、更正、4 个时间块节点、图片/视频/文件 SHA、AgentNote 收发、Wait、observer 403 与撤销后 401。个人脚本与维护源 SHA-256 一致；这不代表最终 Native 候选、剪贴板或设备完成验收。下列维护记录保留各轮原始 red 与当时的待验范围。`
- `2026-11-20` | 更新者：`Codex` | 更新内容概要：`将 seen 约束为 1024 项 LRU digest 窗口；有界 JSON 流按 caller budget cancel/降 page limit 重读；maxPages 仍接受至 10000，但单次每 feed 限 4 页并可续读。` | 核验依据：用户提供 RED run 6e64ae19-797f-485d-b346-13fa0691eecd（19 项 16 pass/3 fail，cleanup true），包括 4000 条 state_too_large、stream cancel false、maxPages=10000 返回 6 页。HTTP source cap 为 1 MiB，Core MAX_TEXT_BYTES 为 128 KiB、MAX_CAPTURE_ORIGINALS 为 256、MAX_FACT_BYTES 为 2 MiB；默认 2 MiB response budget 为合法单 capture 的服务端元数据留出空间。此 patch lane 不运行 tests/HTTP/build；父 lane 应验证 caller-budget companion patch 与生产实现。

- 2026-11-20 | 更新者：Codex | 更新内容概要：FileStateStore 的同路径 load/save/reservation 使用 wx 独占锁并显式返回 journal_busy；状态 JSON 限 512 KiB 且读取有界。 | 核验依据：用户提供 combined run 21db4f73-4ad5-490e-b7f0-b6c41d1b0472 的 result.json 显示 16 SDK 例中 15 通过；同 statePath 的独立 FileStateStore 例实际发出 2 次 POST，预期 1 次，迟到 save 用例通过。源码检查发现 seen 集合随唯一事实累积且未裁剪，因此此上限是 fail-closed，超限保留旧文件。此 patch lane 只做 diff/preflight，不运行测试或 HTTP；应用后由父 lane 重跑 16 例和真实 HTTP。


- `2026-11-20` | 更新者：`Codex` | 更新内容概要：`为 Beta monitor adapter 增加续页/R2 cursor 重建、有界 bytes 与 streamOriginal、全请求 stop 取消、共享 store command reservation 和严格 CLI stdin。` | 核验依据：`当前工作树 HEAD 164534cf6d47f7679793679ccd871bcd4430c42b；adapter 输入 Git blob 86557c18341e023821175bb6812760e962316f7a；DESIGN.md 与用户提供的 boundary RED run aab76273-bc7e-42e0-88e8-675ed2c1d4ea（54 项，48 pass / 6 fail，cleanup true）。此前真实 Core10 Host run 1ff7a998-1a1c-49e5-a654-2e66fbbaf3f1 只证明修复前正常流；本 patch lane 按用户要求未运行测试、build、HTTP、网络、app 或 ADB，应用后仍待父 lane 真实 HTTP 复核。FileStateStore reservation 只覆盖同一个 store 对象在一个进程内的 adapter；不声称跨进程/多个 store 对象 CAS。`

- `2026-11-20` | 更新者：`Codex` | 更新内容概要：`新增 beta-monitor-adapter.mjs 与 beta-monitor.md；更新 Beta monitor reference 路由和主 Skill 维护元数据；另交付个人 exomind-monitor 的单点联动 patch，旧 scripts 和 /act/await 保持原样。` | 核验依据：`仓库 dev-0.6 HEAD d8a90263c3083acc3465fe3e2c69a2fe335c0982、生产 adapter 合同测试 blob 与 monitor adapter DESIGN.md；RED B run851d9aae-79fc-49b3-843c-a135e74bf197 实际 8 fail/0 pass，原因是生产模块缺失。此 patch lane 未运行测试、build 或 live HTTP；Core10 HTTP foundation D 为独立父 lane 证据，应用后仍须真实 HTTP 联调。`

- `2026-11-19` | 更新者：`Codex` | 更新内容概要：`更新 beta-agent-access.md 与 beta-agent-grants.md，记录当前 workspace 的 access/check 支持 Wait/export_bundle；增加最多 30 秒、最多 4 个并发的 profile-sequence Wait，以及最多 8 个 typed timeline 页/1 MiB JSON 的固定 highwater Agent bundle；说明 loopback Native 接入 JSON、Core lifecycle read permit、缺件/截断与支持事实子集。旧 Runtime /act/* 语义保持独立。` | 核验依据：`工作区 HEAD 870e6cad745e7b1ed66b783d17698395b1ff6174 的 crates/exomind-beta-host/src/{agent_access.rs,agent_access_http.rs,agent_wait.rs,agent_wait_http.rs,agent_export.rs,agent_export_http.rs,originals.rs,timeblocks.rs}、Core typed timeline 与外部 original_lifecycle-implementation.patch；仓库 Beta Agent/grant 文档；没有 live/HTTP/Native/外部 Agent 执行。按任务约束未运行测试、编译或应用。根接线 patch 待父代理应用与验收。`

- `2026-11-16` | 更新者：`Codex` | 更新内容概要：`修改主入口与 index 先分流 Beta/旧 RT，新增 beta-agent-access.md；记录精确 P/低权 grant、作者绑定、真实 method/path/body/cursor/error、agent_note stage 能力、HTTP receipt 404，以及 summary 追加/等待/manifest export/access-check 未实现边界。` | 核验依据：`Beta 源码基线 2d8c827b7f813ef55f79a26ddb0e444cc9848cd0 的 exomind-beta-host lib/http/originals_http/timeblocks_http/summary_jobs_http、Core lib/store/originals/summaries + docs/plans/2026-11-13-v0.6-beta-feature-plan.md V16；本轮只读源码与文档核对，无 live/Agent/构建执行。旧 RT 路线保持可用，并非认定旧 RT 接口失效。`

- `2026-04-20` | 更新者：`Codex` | 更新内容概要：`补充 await 自然语言意图到参数映射，覆盖“当前时间块完成”“任务完成”“匿名域监听”“超时 1 小时”，并把这些口径下沉到 tasks/timeblocks references。` | 核验依据：`crates/exomind-runtime/src/agent_await.rs + docs/testing/2026-04-19-await-timeblock-experiment-summary.md + docs/development/runtime-external-access-contract.md`
- `2026-04-19` | 更新者：`Codex` | 更新内容概要：`在主 SKILL 与 timeblocks reference 中明确 timeblock_stopped=专注结束、raw block_end=stop 痕迹、timeblock_ended=反馈完成后的时间块完成，避免 Agent 将“时间块结束”与“时间块完成”混淆。` | 核验依据：`await 联测 live 结果 + crates/exomind-runtime/src/agent_await.rs + crates/exomind-runtime/src/routes/timeblocks.rs + docs/plans/2026-04-19-external-agent-await-api-plan.md`
- `2026-04-19` | 更新者：`Codex` | 更新内容概要：`收口“Agent 默认优先 /act/*，只有无对应动作时才回退 raw API”的入口规则，并把 index / tasks / timeblocks / eventlog references 全部标注为 raw fallback 或 act-first 跳转。` | 核验依据：`#676 + #930 + #931 + runtime-external-access-contract.md + today_planner.rs + agent_await.rs + routes/agent_await.rs + routes/eventlog.rs`
- `2026-04-19` | 更新者：`Codex` | 更新内容概要：`将独立 curl 手册剩余增量信息并入主 SKILL 的外部边界章节，补充当前 `/agents/*` 与 `/act/today-planner/*` 的精确端点列表，并删除 docs/development 下的重复 standalone 文档。` | 核验依据：`仓库全文搜索无反向引用 + 当前 skill references 结构 + 基线 e79ab61b`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`移除 skill 文档中对已删除 curl 手册文件名的残留提及，确认 skill 内只保留单一真源表述。` | 核验依据：`skill 目录全文搜索 + 当前工作区 skill 结构`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`将原 curl 手册内容重构到本 skill 的 references/ 中，主 SKILL 收口为入口层。` | 核验依据：`当前工作区文档结构 + 基线 a83404ad`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`建立“curl 实测偏差 -> 核验 -> 回写本 skill”的同步维护机制。` | 核验依据：`当前工作区文档结构`
- `2026-04-16` | 更新者：`Codex` | 更新内容概要：`新增 references 索引与维护文档，并强制维护前先做执行后差异反思。` | 核验依据：`当前工作区代码 + 当前 skill 结构`
