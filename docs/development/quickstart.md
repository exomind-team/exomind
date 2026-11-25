# 0.6 Beta 开发快速上手

下列命令从仓库根目录运行。做纯前端工作时需要 Node 和 Bun。测试真实持久化另需支持 Edition 2024 的 Rust 工具链及平台编译环境。[版本状态](../AI-CONTEXT.md) · [平台构建](../../BUILD.md)

## 用内存档案运行前端

```sh
bun install
bun run dev --host 127.0.0.1 --port 4300 --strictPort
```

打开 `http://127.0.0.1:4300/beta.html?mock=1`。顶部应显示「内存测试档案」。发送一条合成文字，再刷新，档案会恢复初始样本。这个入口适合验证输入框、列表和界面状态。使用 `--strictPort` 时，端口被占用会在启动阶段明确报错，可换空闲端口并同步更改浏览器地址。

```sh
bun run test --run tests/unit/beta/dev-mock-profile.test.ts tests/unit/beta/main-workspace-client.test.tsx
```

这两组用例验证内存档案的行为，以及主窗口离场、切换档案时的工作区责任。验证 Core 的 SQLite 持久化可按下一节重启真实 Host。验证同步要在接收端回读，输入法、系统分享与声音要在目标设备操作。[Beta 测试与能力边界](../../src/beta/README.md)

## 用真实 Host 验证本机提交

保留上一步的 Vite，在第二个终端启动 Host。以下示例为每次测试生成一个全新的绝对数据根，并允许上一步使用的精确浏览器 origin。

**PowerShell**

```powershell
$betaTestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('exomind-beta-' + [guid]::NewGuid().ToString('N'))
cargo run --locked -p exomind-beta-host --bin exomind-beta -- --data-dir "$betaTestRoot" --port 0 --frontend-origin http://127.0.0.1:4300
```

**POSIX shell**

```sh
beta_test_root="$(mktemp -d)"
cargo run --locked -p exomind-beta-host --bin exomind-beta -- --data-dir "$beta_test_root" --port 0 --frontend-origin http://127.0.0.1:4300
```

Host 输出 `Beta listener ready on …` 后，在可信开发浏览器打开 `http://127.0.0.1:4300/beta.html`。「服务地址」填实际 loopback 地址，「管理凭据」取自**本次新建测试根**私有 `connection.beta.json` 中的 `owner_token`。通过本机私有方式交付到该输入框，结束时断开连接。外部 Agent 另用 Native 签发的档案 grant。单独核对服务身份可读 `GET /beta/v1/hello` 的 `protocol`、设备和运行代次。

选择或创建测试档案，发一条容易辨认的文字，观察本机回执。用 `Ctrl+C` 正常停止自有 Host，再用**同一个测试根**启动，重新核对实际监听地址并回读该事件。首次用新根用于隔离测试，重启复用它用于验证持久化。其他设备接力需另做成员和原件核验。[Host 参数与授权](../../crates/exomind-beta-host/README.md) · [首次使用指南](../product/beta-first-session.md)

## 选择其他入口

| 场景 | 入口 |
|---|---|
| 桌面／Android Native 的窗口、文件、声音和权限 | [构建指南](../../BUILD.md)、[Native 工作区](beta-native-workspace.md)和对应候选的 build-info |
| 外部 Agent 读取档案 | [公共监控 Skill](agent-skills.md)、[档案授权](beta-agent-grants.md) |
| Alpha／0.5 维护 | 默认 `index.html` 与通用 Tauri 命令。旧 CLI 单独依赖 `exomind-runtime`。[历史架构](../architecture/overview.md) |
| 独立 Node 迁移试验 | [`next/README.md`](../../next/README.md)指定的运行与数据目录 |

曾位于此路径的 VoiceIME v2.0 产品需求原文现归入[语音研究资料](../research/2026-02-03-voiceime-product-requirements.md)。
