# macOS 安装说明

先确认你拿到的是发行 DMG 还是开发用压缩包。β27 的 Build Validation #29 为 `macos-arm64` 构建可执行程序，工作流使用 `--no-bundle`。开发者可在对应 Actions run 查看制品与 build-info。面向用户的 DMG 来自各次 GitHub Release 的 Assets。[0.6 候选及制品来源](AI-CONTEXT.md) · [GitHub Releases](https://github.com/exomind-team/exomind/releases) · [Beta 构建配方](../.github/workflows/beta-build-validation.yml)

## 已取得发行 DMG

1. 用“关于本机”检查芯片。Apple Silicon 选择 `arm64` 或 `aarch64`，Intel 选择 `x86_64`，`universal` 包支持两种架构。某次发行只有 arm64 资产时，Intel 用户需另取匹配构建。Rosetta 的转换方向是 Apple Silicon 运行 Intel 程序。
2. 从所选版本的发布页下载，在发布方提供校验值时用 `shasum -a 256 文件名.dmg` 对照。将 `.app` 拖到“应用程序”后打开。
3. 遇到签名提示时，核对发布来源、校验值和具体错误。对于已核实来源、受系统策略允许的应用，可按 macOS 的“隐私与安全性 → 仍要打开”流程操作。[Apple 的首次打开说明](https://support.apple.com/guide/mac-help/mh40616/mac)

## 开发候选的验证

从相同 run 取得可执行文件与 build-info，核对平台、版本、应用源码 SHA 和文件摘要。在独立测试档案下验证实际启动。打包、签名、公证和目标 Mac 上可启动分别有各自的证据。[构建指南](../BUILD.md)

遇到“应用已损坏”或架构错误时，记录 macOS 版本、芯片、制品来源和摘要。对 `.app` 可用 `codesign --verify --deep --strict --verbose=2 应用路径` 查看签名验证结果，再决定是否重新下载或向维护者反馈。[安装问题记录](https://github.com/exomind-team/exomind/issues/954)
