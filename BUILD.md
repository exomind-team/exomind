# ExoMind 构建指南

0.6 Beta 的原生验证使用 [Beta Build Validation](.github/workflows/beta-build-validation.yml) 和 [Beta Tauri 配置](src-tauri/tauri.beta.conf.json)。按[版本状态](docs/AI-CONTEXT.md)选择待验证的源码和对应制品。

## 环境要求

前端需要 Bun 与 Node。Rust 工作区包括使用 Edition 2024 的 Core 和 Host，请使用支持该 edition 的稳定工具链。Windows 原生编译需要 MSVC C++ Build Tools 与 Windows SDK，macOS 需要 Xcode Command Line Tools。Android 的 JDK 17、SDK platform、build-tools、NDK 和目标 ABI 以对应候选配方为准。CI 的依赖版本可从上方工作流读取。

## 本地构建

在仓库根目录安装依赖。Web 构建检查 TypeScript 并生成包含 `beta.html` 的多入口资源。

```sh
bun install
bun run build:web
```

只需交互测试时使用[快速上手](docs/development/quickstart.md)。单独验证 Core 的本机持久化可用：

```sh
cargo test --locked -p exomind-core --test local_commit
```

### 桌面 Beta 可执行文件

在匹配的桌面平台，从已选源码执行与 CI 同类的调试构建。显式传 Beta 配置和互斥的 Cargo feature，产物位置以 Cargo/Tauri 输出为准。

```sh
node node_modules/@tauri-apps/cli/tauri.js build --ci --debug --no-bundle --config src-tauri/tauri.beta.conf.json -- --locked --no-default-features --features custom-protocol,beta-native-only
```

精确复现候选时，使用原 run 的目标 triple、`VITE_APP_VERSION`、源码、锁文件与完整 recipe。首次运行测试二进制用单独的应用目录。`index.html` 与默认 `alpha-legacy-runtime` 属于另一套装配。[Beta 前端与 Native 入口](src/beta/README.md)

### Android

从 Beta 工作流的 `android` job 依次核对 fresh init、[生成目录准备器](scripts/dev/beta-android-prepare.ts)、`--split-per-abi` 构建、签名、最终 APK manifest 和 build-info。基线配方包含 `aarch64`、`x86_64`，按候选请求决定 debug/release 和有无测试后缀。稳定包名与 QA 后缀影响能否保数据升级，请在安装前核对设备上已有包的 ID 与签名。系统分享、实际输入法、前后台恢复分别在同一 APK 上验收。[Android Windows 联调](docs/development/tauri-android-windows-playbook.md)

## CI/CD 自动化构建

| 查什么 | 依据 |
|---|---|
| 应用源码和预期版本 | [候选锁](.github/beta-build-candidate.json)中的 `source_ref` 和 `expected_sha` 指向同一完整 SHA，`expected_version` 应匹配该源码的 Beta 配置。 |
| 构建了什么 | 对应 Actions run 的 `resolve-source`、平台 jobs、制品名和 build-info。桌面 `--no-bundle` 产生可执行验证制品，Android job 提供 APK。 |
| 哪些行为通过 | [Beta Source Contracts](.github/workflows/beta-contract-guard.yml) 的实际用例；设备结果另按具体制品、数据、平台和操作记录。 |
| 哪个版本已公开发行 | [GitHub Releases](https://github.com/exomind-team/exomind/releases) 中的 tag、状态与 Assets。公开发布另循[发布治理](skills/release-governance/SKILL.md)。 |

## 常见问题

- **页面或版本不对。** 核对 `beta.html`、Beta overlay 和 Cargo feature，根 `package.json` 的 Alpha 版本用于默认入口。
- **本地改动在下载的包中找不到。** 对照 build-info 的应用源码和构建锁，再查对应 run。发布请求的提交与应用源码各有字段。
- **原生启动失败。** 先记录报错、平台、应用版本和测试数据根。保留现有档案，在新建独立目录复核启动。[Host 使用说明](crates/exomind-beta-host/README.md) · [Windows 调试手册](docs/development/tauri-mcp-windows-playbook.md) · [macOS 核验](docs/macos-install.md)
