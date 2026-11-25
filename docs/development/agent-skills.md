# 外部 Agent 接入 0.6 Beta

Beta 的接入单位是 Native 签发给一个档案的 grant。先按任务选择角色，再验证端点与访问范围。通用 `exomind-monitor` 的维护源是独立仓库，开发者本机的 `exomind-dev-patrol` 管理日用巡检。[监控 Skill 仓库](https://github.com/exomind-team/exomind-monitor-skill) · [授权与撤销](beta-agent-grants.md) · [Host 路由](../../crates/exomind-beta-host/README.md)

## 在新机器上选择入口

2026-11-25 核对公开仓库时，远端只有 `main`（`113ba8c2`），包含 0.5 的 `monitor.js`、`send.js` 等脚本。远端标签列表为空。本机的 `v0.6.0` 标签对应提交 `932737ae`。全新环境可使用项目 `dfb2b73c` 留存的 Beta adapter 和用法，或运行合成档案的 Host HTTP 测试。[固定版 adapter 使用说明](https://github.com/exomind-team/exomind/blob/dfb2b73ce15a56142edd725368af89723865dd72/skills/exomind-rt-agent-access/references/beta-monitor.md) · [开发快速上手](quickstart.md) · [Host 隔离测试](../../crates/exomind-beta-host/tests/host.rs) · [公开版本列表](https://github.com/exomind-team/exomind-monitor-skill/tags) · [0.5 固定源码](https://github.com/exomind-team/exomind-monitor-skill/tree/113ba8c2d44fa7b79de51f427bf2f4b1998294c1)

已有可信的 0.6 checkout 时，先运行自检。以下为 POSIX shell 示例。`MONITOR_HANDOFF` 由调用者指定为已获授权的私有文件路径，`HISTORY_OUT` 指向本机私有输出文件。凭据仅由 CLI 从 handoff 读取，历史输出包含记录正文。

```sh
monitor="$HOME/.claude/skills/exomind-monitor/scripts"
node "$monitor/verify.mjs"
node "$monitor/cli.mjs" --handoff "$MONITOR_HANDOFF" doctor
node "$monitor/cli.mjs" --handoff "$MONITOR_HANDOFF" read-all --fresh --out "$HISTORY_OUT"
```

`doctor` 先核对 loopback `/beta/v1/hello`，再以该档案的 bearer 执行 `access/check`。Host 回报当前 `runtime_id`、`device_id`、`profile_id`、`grant_kind`、`agent_id` 和能力。CLI 显示的 `grantId` 来自 Native 签发时的 `grant.grant_id`。新快照用 `--fresh`，中断续读沿用原水位、游标和同一作用域的状态。读取完整度按 CLI 列出的 typed feeds 解释。读原件另核对实际字节、长度与 SHA-256。[分页、等待和 bundle](beta-agent-read-tools.md)

该版本的通用 adapter 接受 `observer` 和 `agent_note`。后一角色在获准追加说明时可用 `note --text-file "$NOTE_FILE"`。`summary_producer` 使用 Host 的 `external-summaries` 接口和支持该角色的客户端。写入超时后用原 `command_id` 查回执，再按 `event_id` 核对档案、作者与内容。远端复制按目标副本另验。[角色与路由](../../crates/exomind-beta-host/README.md) · [外部摘要回归](../../crates/exomind-beta-host/tests/external_summaries.rs)

## 本仓库如何取得测试 adapter

当前工作树将 `EXOMIND_BETA_MONITOR_SDK_PATH` 作为 adapter 文件的绝对路径，缺省读取已安装 Skill 下的 `scripts/beta-monitor-adapter.mjs`。前端契约和 Host 的外部夹具共用这项约定。[前端契约](../../tests/unit/scripts/beta-monitor-adapter.test.ts) · [Host 测试夹具](../../crates/exomind-beta-host/tests/fixtures/monitor-summary-reader.mjs)

工作树的 `Beta Source Contracts` 工作流指定 `MONITOR_SKILL_REF=v0.6.0`。全新 runner 依赖这个 ref 在公开仓库可取，以及 `verify.mjs` 自检通过。`dfb2b73c` 的源码 CI #104 通过时用的是该提交内的 adapter。外置版本的 CI 应以包含新工作流的 run 核对。[工作树的工作流](../../.github/workflows/beta-contract-guard.yml) · [#104 的固定工作流](https://github.com/exomind-team/exomind/blob/dfb2b73ce15a56142edd725368af89723865dd72/.github/workflows/beta-contract-guard.yml)

## 已登记机器上的日用巡检

普通会话与定时任务从本机私有 `exomind-dev-patrol` 进入，共用工作区忽略目录中的唯一登记文件 `.local/exomind-dev-patrol/handoff.json`。由值守入口定位获准的 Beta 实例，用绑定档案和所需能力核验。缺少登记、凭据受损、档案不符或授权被拒时，按对应原因报告。瞬时故障按有限预算重试。保留 handoff 和令牌在受保护位置。

默认巡检只读。反馈按档案 UUID 隔离、按事件 ID 去重。用户批准写回时，按实际角色与来源写入并查回执。T3 交接、定时策略与本机位置由私有流程维护。旧 Runtime 的 `/agents/*` 与 0.5 脚本按其固定版本查阅。[旧 Runtime 接口](exomind-runtime-agents-api.md)
