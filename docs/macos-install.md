# macOS 安装说明（无 Apple Developer 账号过渡版）

> **状态**：过渡方案。ExoMind 当前的 macOS 安装包是**未签名 + 未公证**的构建产物。原因：我们暂未申请 Apple Developer 账号（$99/年）。在 macOS 14+ 的默认 Gatekeeper 设置下，下载后双击 .app 会弹出 **"ExoMind.app 已损坏，无法打开"** 错误——这是 Gatekeeper 的标准拦截提示，**不是文件真的损坏**。
>
> 长期方案见 `macos-distribution-strategy.md`。

## 给遇到 "X.app 已损坏" 错误的用户

按你的 macOS 版本选对应方案，**30 秒搞定**：

### 方案 A：右键打开（最简单，macOS 13 / 14 / 15 全版本适用）

1. 在「应用程序」文件夹里**右键**点击 `ExoMind.app`（不是双击）
2. 弹出菜单里选「打开」
3. 弹出确认框：「ExoMind.app 来自身份不明的开发者，您确定要打开吗？」
4. 点「打开」
5. 之后即可正常双击启动

> 这个方法的原理是：右键打开走的是"用户主动确认"通道，Gatekeeper 不会再次拦截。比 `xattr` 命令更直观。

### 方案 B：清除隔离属性（适合命令行用户）

```bash
# 替换路径为你的实际安装位置
sudo xattr -cr "/Applications/ExoMind.app"

# 然后正常双击即可
```

> `xattr -cr` 清除 macOS 给下载文件打的 `com.apple.quarantine` 隔离标记，Gatekeeper 看到没隔离标记就放行。

### 方案 C：系统设置永久放行

1. 打开「系统设置」→「隐私与安全性」
2. 滚到页面底部，找到「安全性」区域，会看到一行："ExoMind.app 已被阻止打开"
3. 点右侧的「仍要打开」按钮
4. 弹出确认框再点「打开」

> 只对**这一次下载有效**，重新下载后需要再来一次。

### 方案 D：ad-hoc 自签（arm64 上 A/B/C 都失败时的免费终极解）

**什么时候用**：你是 Apple Silicon（M1/M2/M3/M4），方案 A 右键打开、方案 B `xattr` 都还报「已损坏」。

**根因**：当前安装包是**完全未签名**的。而 macOS 14.4+ 对 arm64 二进制**强制要求"至少有一个签名"**（哪怕是你自己机器上的 ad-hoc 自签也行）——纯无签名的 arm64 app 系统直接判"损坏"拒绝执行，光清隔离标记不够。

解法：在**你自己的 Mac 上**用 `codesign` 给它打一个 ad-hoc 签名（`-` 代表 ad-hoc 身份，**不需要 Apple 账号、不需要证书、完全免费**），再清隔离标记即可运行：

```bash
# 路径替换成你的实际安装位置
# 1) ad-hoc 自签：--sign - 是 ad-hoc 身份；--deep 连同内嵌的 ExoMind-RT 等子二进制一起签
sudo codesign --force --deep --sign - "/Applications/ExoMind.app"

# 2) 清除下载隔离标记
sudo xattr -cr "/Applications/ExoMind.app"

# 3) 启动
open "/Applications/ExoMind.app"
```

验证签名是否成功（看到 `Signature=adhoc` 即对）：

```bash
codesign -dv --verbose=2 "/Applications/ExoMind.app" 2>&1 | grep -i signature
```

> 说明：ad-hoc 签名只让 app **在本机能跑**，它**不被 Apple 信任、不能公证、不能跨机分发**——把这台机器签好的 .app 再拷给别人，对方仍要各自执行一遍上面的命令。`--deep` 已被 Apple 标记为 deprecated，但对"重新签一个下载来的现成 .app"它仍是最省事的一行；本场景可放心用。

## 验证你的 macOS 架构（Intel vs Apple Silicon）

```bash
uname -m
# arm64 = Apple Silicon (M1/M2/M3/M4)
# x86_64 = Intel Mac
```

| 架构 | DMG 兼容性 | 备注 |
|------|------------|------|
| Apple Silicon (arm64) | ✅ 直接安装 | 当前 DMG 默认就是 arm64 |
| Intel (x86_64) | ⚠️ 需 Rosetta | 当前 DMG 暂未出 x86_64 版，可装 Rosetta 后运行：`softwareupdate --install-rosetta` |

> 计划下个版本（v0.4.23+）出 **universal2 DMG**（一份兼容两种架构），届时 Intel 用户也免 Rosetta。

## 验证下载完整性

如果怀疑 DMG 本身损坏（极少见，常见于下载中断或被中间 CDN 篡改）：

```bash
# macOS 自带 shasum 校验
shasum -a 256 ~/Downloads/ExoMind_0.4.22_aarch64.dmg

# 期望值见 GitHub Release 页面下的 "校验和" 区块
# 或下载 exomind-release-manifest.json 后查 macos-aarch64.sha256 字段
```

## 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 双击弹"已损坏" | Gatekeeper 拦截（不是真损坏） | 用方案 A/B/C 任意一种 |
| 右键打开也弹"已损坏" | macOS 14.4+ arm64 强制签名（当前包未签名） | **用方案 D ad-hoc 自签**（免费，无需 Apple 账号）；想根治到"用户只需 `xattr`"见下方「临时构建说明」的 ad-hoc 构建选项 |
| 启动后立即闪退 | 可能是 Gatekeeper 杀进程 | 终端里直接运行 `/Applications/ExoMind.app/Contents/MacOS/ExoMind` 看完整崩溃日志 |
| "需要 ARM 架构" / "需要 x86 架构" | DMG 架构与机器不匹配 | Intel 装 Rosetta（见上）；arm64 应无此问题 |
| `xattr` 报"Operation not permitted" | SIP 限制 | 重启按住 Cmd+R 进恢复模式，`csrutil disable`，重启后再试（**不推荐**，仅限老 Mac） |

## 临时构建说明（开发者）

如果你想本地构建一份"至少能跑"的 DMG，CI 用的是 `npx tauri build` 默认配置。**在你自己 Apple Silicon 机器上 build 出来的 .app** 可以直接双击跑（不签名，本机 Apple Silicon 自有 Gatekeeper 信任）。但**这台机器 build 出来给他人**仍会触发"已损坏"。

### 推荐：让 CI 直接出 ad-hoc 签名包（用户只需 `xattr`，省掉 codesign 那步）

当前 `tauri.conf.json` 的 `macOS` 段**没有设 `signingIdentity`**，所以 Tauri 打包时**完全不签名** → arm64 用户必须自己跑方案 D 的 `codesign`。把签名身份设成 ad-hoc，发布包就自带签名了：

```jsonc
// src-tauri/tauri.conf.json → bundle.macOS
"macOS": {
  "entitlements": "entitlements.plist",
  "hardenedRuntime": true,
  "minimumSystemVersion": "10.15",
  "signingIdentity": "-"          // 新增：- = ad-hoc 自签，免 Apple 账号/证书
}
```

效果：CI 产出的 .app 已带 ad-hoc 签名（连同 `entitlements.plist` 一起应用），arm64 用户**只需清隔离标记**就能跑：

```bash
sudo xattr -cr "/Applications/ExoMind.app" && open "/Applications/ExoMind.app"
```

**取舍 / 注意**：

- ad-hoc 签名**不能公证（notarize）、不能跨机信任**，只是把"未签名"抬到"有签名"，刚好越过 arm64 的强制签名门槛。仍属过渡方案。
- 它**与未来真正的 Apple Developer 签名互斥**：等申请到证书后，把 `signingIdentity` 换成真实证书名（或经 CI secret 注入），并接回公证流程——别让 `"-"` 留在发布配置里盖掉真签名。本仓库的真签名/公证管线已配好（`entitlements.plist` + CI 透传 secret），只差 Apple 账号。
- 因此这里**只作记录、未改 `tauri.conf.json`**；要启用就加上面那一行 `signingIdentity` 即可。

## 反馈

- 用了方案 A/B/C 还跑不起来？→ 在 [GitHub issue #954](https://github.com/exomind-team/exomind/issues/954) 贴完整错误截图（包含"更多信息"展开后的内容）
- 想推动项目方出签名版？→ 见 [issue #954 的"长期方案"段](https://github.com/exomind-team/exomind/issues/954) 或仓库内 `macos-distribution-strategy.md`
