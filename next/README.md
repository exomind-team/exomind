# 外心 · 上下文缓冲区

**0.6.0-rebuild.1 · 独立 Web-first 搬迁候选，不是正式发行版。**

先记下，再整理。文字、图片与文件进入同一个本地空间；时间块表达工作、休息与生活状态。其他设备补齐记录，模型在有限证据上生成回顾，WinCraft 只读投影当前状态。

本轮依据 2026-11-10 脱敏本地交接包实现。它不是旧外心 0.5.x 的热更新，不会自行寻找、导入、覆盖旧数据库。源树基线为 `exomind-team/exomind@ddb1ba1a6c1e0760af77b55d5659df44ad253b34`。`0.6.0-rebuild.1` 仅标识这个候选；未修改主仓版本、未复用失败的 `v0.5.2` 标签、未推送或发布。

## 立即运行

已实测 Node.js **22.16.0 / Linux x64**；代码要求至少 Node 22.16。核心使用 Node 内置模块，无 npm 运行依赖，**不用先执行 npm install**。此测试版本的 `node:sqlite` 会显示实验性警告；这项依赖及 Windows/Android 适配仍需维护者确认。

```sh
cd next
npm run verify
node runtime/cli.mjs --data-dir .local/rebuild --name "我的电脑" --port 19490 --open
```

Windows 可双击 `start-windows.cmd`，前提是 Node 已安装。这不是打包的原生 EXE，启动器尚待 Windows 实测。它打开系统浏览器；`Ctrl+C` 关闭 Runtime。浏览器关掉不影响后台同步和总结队列，进程退出才停止服务。

不开浏览器也可运行：去掉 `--open`。启动日志只显示地址与私有连接文件路径，不打印令牌。手动打开页面后，可输入 `connection.runtime.json` 中的 owner token；该文件不能进 Git、公共日志或聊天附件。

## 已写入代码的能力与验证边界

| 责任 | 当前实现 | 本轮验证 |
|---|---|---|
| 可靠记录 | SQLite 事务回执、命令去重、重启保留、原始资料不自动删除 | API、持久化及进程测试通过 |
| 图片与文件 | 分块、续传、SHA-256 校验；文字与附件分阶段同步 | 二进制传输、损坏与未完成路径通过 |
| 时间块 | 开始、结束、当前状态、开始备注、结束与追加反馈 | 状态与重试测试通过；并发事实保留 |
| 同版本同步 | 邀请配对、独立身份、游标与历史前缀检查、双向自动拉取 | 双实例、两真实进程、强制退出后补齐通过 |
| 小型总结 Harness | 持久任务、证据快照、有界模型请求、取消围栏、失败重试 | 模拟模型与 HTTP 适配测试通过；未调用真实模型 |
| Web 客户端 | 记录、文件、时间块、检索、设备、回顾和外部接入 | 语法检查；实际浏览器 E2E 被环境访问策略阻止 |
| WinCraft | 复用其 Client 的只读 Python 提供者 | 3 项纯投影测试；真实宿主与原生窗口未验证 |
| 可移植快照 | 有界记录快照＋原始附件；校验后恢复到新设备身份 | 导出、损坏拒绝、恢复测试通过 |

详见 [验证记录](evidence/VALIDATION.md)。源码存在、静态检查、协议测试、真实窗口验收不是同一层。

## 明确没有做

没有自建任务管理、目标系统、通用 Agent 终端或窗口平台。没有自动抓取聊天软件、打开链接、解析附件、跟随播放列表中的本机媒体路径。没有正式删除/清理协议、旧版导入器、原生快捷唤起、APK/EXE、mDNS/二维码自动发现。没有完成 WinCraft 原生联调、Obsidian 自动写入或真实 EasyTier 网络验收。

本版采用 **Node + SQLite 作为可运行的参考 Runtime**，不是已决定替换 Rust/Tauri。制作环境缺少 Rust 工具链，故没有交付未经编译却声称可用的 Rust 壳。能否把本候选 Runtime 作为桌面 sidecar，或将已验证的语义移回 Rust，见 [本地交接](docs/LOCAL_CODEX_HANDOFF.md)；这是原生落地的待裁技术选择。Android 不能假定自带 Node；本包不是安装即用的手机应用。

## 双机实验

先使用两份隔离数据目录。每个实例当前只服务一个空间；第二台必须是空白实例，才能加入第一台空间。双方页面分别连接自己的本机 Runtime。

推荐 HTTPS 与经过校验的证书：

```sh
node runtime/cli.mjs --data-dir .local/pc --name "电脑" --host 0.0.0.0 --port 19490 --advertise https://pc.example.invalid:19490 --tls-cert /private/server.pem --tls-key /private/server-key.pem --tls-ca /private/ca.pem
```

这是语法示例，保留域名不可直接使用。证书 SAN 必须匹配实际访问地址；浏览器、Node 客户端和对端的信任都要验证。**不使用忽略证书验证的开关。**

仅用于明确受信私网的 HTTP 实验：

```sh
node runtime/cli.mjs --data-dir .local/pc --name "电脑" --host 0.0.0.0 --port 19490 --advertise http://192.0.2.10:19490 --allow-trusted-http
```

示例 IP 需替换为自己的 LAN/EasyTier 地址。对端配置同理。本模式令牌和数据在应用层为明文，绝不能暴露公网；本包不安装或配置 EasyTier。浏览器仍从各设备的 `http://127.0.0.1:19490` 打开，远程明文网页不是 Web Crypto 的可靠安全上下文。

在第一台「设备连接」生成邀请；通过可信渠道交给第二台，在第二台粘贴邀请并填写可供对方回连的本机地址。双方都使用同一协议，配对后自动补齐。邀请含临时凭据，十分钟有效，不能公开分享。

状态“已拉取对端当前快照”只确认本机拉取到一个特定对端快照，**不代表所有设备已收到本机新记录**。更改地址不会更换身份和密钥；暂停/撤销不会抹掉对方早已持有的数据。失联不会被自动删除。

## 总结模型

不配置模型，记录、时间块和同步仍独立工作，总结任务显示“待配置模型”。按本地实际协议设置完整地址和模型名，然后重启候选 Runtime：

```powershell
$env:EXOMIND_MODEL_URL = 'http://127.0.0.1:实际端口/v1/chat/completions'
$env:EXOMIND_MODEL_NAME = '你已验证的模型标识'
# 密钥在本机安全地设置到 EXOMIND_MODEL_API_KEY；不要粘贴到公共命令记录。
node runtime/cli.mjs --data-dir .local/rebuild --open
```

当前只实现 Chat Completions 兼容非流式文本请求。没有声称兼容所有厂商、推理参数、Responses 或 Anthropic 协议。HTTP 客户端直连目标，**不继承系统浏览器代理**；与本地 Magpie 联调时必须分别核对路由、认证、真实计费和网络。模型接入意味着向该端点发送选取的文本证据，请使用合成资料先测试。

总结最多三次自动尝试，输入按字符预算截取并标明覆盖缺口。取消后迟到结果不能写入。只校验引用属于已读取集合，**不证明模型陈述都受到语义支持**。不把记录少解释为现实中没做事。

## 外部 Agent 与 WinCraft

Agent 从 [专用 skill](skills/exomind-next-access/SKILL.md) 开始；先创建独立令牌，不把 owner 凭据分发给普通工具。

```sh
node tools/client.mjs token --connection .local/rebuild/connection.runtime.json --role observer --name WinCraft --out .local/wincraft-observer.json
node tools/client.mjs status --connection .local/wincraft-observer.json
```

WinCraft 接法见 [集成说明](docs/INTEGRATIONS.md)。该桥接不复制其客户端，也不假报浮窗联调已通过。

## 备份与恢复

```sh
node tools/portable.mjs export --connection .local/rebuild/connection.runtime.json --out .local/export-001
node tools/portable.mjs inspect --bundle .local/export-001
node tools/portable.mjs restore --bundle .local/export-001 --out .local/restored-001 --name "恢复验收"
node runtime/cli.mjs --data-dir .local/restored-001 --port 19491
```

目标目录必须不存在。快照包括有限上界的业务记录与其引用附件；缺附件时导出不算成功。恢复生成新设备身份，需要重新配对。它**不是整机克隆或完整凭据备份**：不含模型密钥、配对密钥、总结任务队列和浏览器草稿，也不是旧版数据迁移工具。

## 目录与继续开发

`runtime/contracts.mjs` 定义协议与边界；`store.mjs` 持有事实和领域事务；`blobs.mjs` 管理附件；`sync.mjs` 管理恢复；`summary.mjs` 管理有限模型任务；`server.mjs` 是 HTTP/权限适配；`cli.mjs` 才负责进程、目录、模型与浏览器启动。

`web/` 不持有业务真相，只留草稿和交互状态。`integrations/` 为可选提供者。核心没有通用插件注册框架。下一项功能修改应先寻找拥有该状态的模块，而不是在页面里增加后台业务调度。

先读 [本地 Codex 交接](docs/LOCAL_CODEX_HANDOFF.md)、[架构决定](docs/DECISIONS.md)、[API](docs/API.md) 与 [安全边界](docs/SECURITY.md)。
