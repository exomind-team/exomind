> 最后更新：`2026-04-19` | 更新者：`Codex` | 更新内容概要：`补充 /act 优先、raw fallback 的 references 装配规则。`

# Reference Index

## 加载原则

- 先判断目标动作是否已有 `/act/*` 契约；若有，优先对应 `/act` 文档/代码，本目录主要提供 raw fallback / debug 资料。
- runtime 使用时，先读主 `SKILL.md`，再按任务域只加载 1-2 份最相关的 reference。
- 如果任务是维护 skill 本身，先读 `maintenance.md`，不要跳过执行后差异反思。
- 不要因为“可能会用到”就把全部 reference 一次性读入上下文。

## 文件地图

| 文件 | 何时读取 | 典型关键词 |
|------|----------|-----------|
| `discovery-and-diagnostics.md` | 健康检查、版本、拓扑、profiles、signals、鉴权边界、PowerShell curl 约定 | `health` `version` `profiles` `signals` `token` `curl.exe` |
| `eventlog.md` | eventlog 读写、raw watch、按时间窗排查、备份导入、清空 | `eventlog` `watch` `since_id` `since_timestamp` `DELETE /eventlog` |
| `tasks.md` | task raw fallback：列表、创建、更新、状态迁移、取消、备份导入、复制 | `tasks` `transition` `cancel` `shortcut=true` `replication` |
| `timeblocks.md` | timeblock raw fallback：生命周期、start/stop/end、pause/resume、反馈、导入导出、复制 | `timeblocks` `stop` `end` `feedback` `taskStatusOutcomes` |
| `maintenance.md` | 执行后差异反思、维护路由、顶部元数据、维护记录 | `维护` `反思` `差异` `更新记录` |

## 跨域组合

- `eventlog + tasks`：先读 `eventlog.md`，再读 `tasks.md`
- `timeblocks + tasks`：先读 `timeblocks.md`，再读 `tasks.md`
- `发现档案或鉴权问题 + 任意业务域`：先读 `discovery-and-diagnostics.md`，再读对应业务域文档
- `等待 / 监听`：先回主 `SKILL.md` 判断是否应走 `/act/await`；只有要 raw cursor / catch-up / debug 时才读 `eventlog.md`
- `执行完 curl 任务准备回写经验`：先读 `maintenance.md`，再决定要补哪份业务文档

## 改动路由提示

- 主流程、风险分级、真相源优先级、外部边界变化：改 `../SKILL.md`
- 连接、鉴权、profiles、signals、PowerShell 约定变化：改 `discovery-and-diagnostics.md`
- 事件日志契约变化：改 `eventlog.md`
- 任务接口契约变化：改 `tasks.md`
- 时间块接口契约变化：改 `timeblocks.md`
- references 的索引与维护方法变化：改 `index.md` 或 `maintenance.md`
