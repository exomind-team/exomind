# Tauri Android Windows Playbook

> 持续更新。用于沉淀在 Windows 宿主机下，调试 ExoMind Android APK 的构建、安装、ADB、Tauri MCP 与系统层验收经验。

> 桌面真窗 / raw bridge 经验见 [Tauri MCP Windows Playbook](tauri-mcp-windows-playbook.md)。

> 本文中的端口、AVD 名称、设备序列号、ABI、generated Android 路径等，除非明确写成“通用规则”，否则都只是对应阶段的现场样例，复用时必须替换为当前实例真值。

## 目的

- 为后续 Agent 提供 Windows 宿主机下的 Android 调试主链，而不是每次从零摸索。
- 把“构建问题”“安装问题”“WebView 旧资源问题”“Android 系统策略问题”拆开判断，避免混成一句“APK 没更新”。
- 固化一套不依赖 Android Studio GUI 的可复用链路：`AVD -> adb -> Tauri Android build -> Gradle assemble -> adb install -> Tauri MCP + dumpsys/logcat`。

## 去本地化约定

本文刻意不用私人绝对路径，而是统一用占位符表达本地环境。复用时先把这些占位符替换成当前机器真值。

| 占位符 | 含义 | 去隐私化例子 |
| ------ | ---- | ------------ |
| `<repo-root>` | 当前仓库根目录 | `H:\workspace\exomind` |
| `<android-sdk-root>` | Android SDK 根目录 | `C:\Users\<user>\AppData\Local\Android\Sdk` |
| `<android-studio-jbr>` | Android Studio 自带 JBR | `D:\Tools\Android\Android Studio\jbr` |
| `<cargo-target-root>` | Android Rust 产物根目录 | `G:\cargo-target\exomind` |
| `<avd-name>` | 当前 AVD 名称 | `Medium_Phone_API_35` |
| `<device-serial>` | 当前 adb 设备序列号 | `emulator-5554` |
| `<abi>` | 本轮目标 ABI | `x86_64` |
| `<gradle-assemble-task>` | 当前 ABI 对应的 assemble task | `:app:assembleX86_64Debug` |
| `<gradle-rust-build-task>` | 当前 ABI 对应的 rustBuild task | `rustBuildX86_64Debug` |
| `<bridge-port>` | Tauri MCP bridge 端口 | `9223` |
| `<rt-port>` | Android 侧 RT HTTP 端口 | `9124` |

补充规则：

- 仓库内 generated Android 路径保留 repo-relative 写法，例如：
  - `src-tauri/gen/android/app/src/main/jniLibs/<abi>/`
  - `src-tauri/gen/android/app/src/main/assets/tauri.conf.json`
- `9124`、`9223` 这类值只代表某一轮现场样例，不是硬编码常量。
- 若历史报告写了旧端口、旧 AVD 或旧 ABI，优先相信当前现场实测，而不是相信旧文档。

## 阶段补记：Windows + AVD + APK 联调（2026-04-16）

### 本轮目标

- 确认 Windows 本机 Android 调试工具链是否完整可用。
- 找到一条不依赖 Android Studio GUI 的稳定 APK 构建、安装、启动与调试链路。
- 在真实 AVD 上验证以下能力是否已经进入当前 APK：
  - 专注页保持亮屏
  - 时间块后台结束提醒
  - 后台结束后可选自动回前台 / 回到当下

### 本轮结论

- AVD 本轮并未真正启动失败；emulator 的 GPU / snapshot 噪音日志不能直接当成失败证据，`sys.boot_completed=1` 才是更可靠的启动判据。
- 当前机器上最稳的 Android 调试链路不是 `tauri android dev`，而是：
  - 先让 `bun run tauri android build` 产出 Android Rust `.so`
  - 再手工同步 `jniLibs` 与 `assets/tauri.conf.json`
  - 最后直接 `gradlew assemble -x rustBuild*` + `adb install -r`
- `ANDROID_HOME`、系统 PATH 里的旧 `adb`、旧报告里的 RT 端口都不可信；都必须以当前现场真值为准。
- 新 APK 复测后可以确认：
  - 专注页保持亮屏：通过
  - 后台结束通知：通过
  - 自动回前台：原生链已触发，但被 Android 后台拉起策略 `BAL_BLOCK` 拦截
- 设置页里仍显示 `版本 0.3.6`，但这已经不能继续当作“旧 APK 未刷新”的证据；当前更像是前端 fallback 展示问题，参见 [settings-registry.ts](../../src/ui/app/config/settings/settings-registry.ts)。

### 当前已确认的关键约束

- 系统层 `ANDROID_HOME` 原值可能不可信；命令执行前应显式覆盖到 `<android-sdk-root>`。
- 若系统里残留旧版 `adb server`，会出现 `adb server version (...) doesn't match this client (...)`；必须统一改用 `<android-sdk-root>\platform-tools\adb.exe` 重启 server。
- `tauri android dev` 在当前 Windows 现场不是最稳定路径，不应作为主调试链路。
- `bun run tauri android build --debug --target <abi>` 目前仍可能卡在两类问题：
  - Tauri CLI 试图把 `.so` 符号链接进 `jniLibs`，但 Windows 现场不一定允许创建 symlink
  - Gradle `rustBuild*` 任务会再次回调 `android-studio-script`，受临时 `*-server-addr` 文件与 Windows 环境状态影响不稳定
- Android 构建前，需确保 [lib.rs](../../src-tauri/src/lib.rs) 中不把 `main_window.set_title(...)` 这类桌面 API 无条件暴露给 Android / iOS 目标；这在本轮曾是实际编译阻塞点。
- 当前设备侧 RT HTTP 端口不能沿用旧报告假定值；本轮真值是 `127.0.0.1:9124`，而不是更早现场里的 `9323`。

## 推荐调试顺序

### 1. 启动 AVD 并确认真启动

```powershell
$androidSdkRoot = '<android-sdk-root>'
$avdName = '<avd-name>'
$deviceSerial = '<device-serial>'
$adb = Join-Path $androidSdkRoot 'platform-tools\adb.exe'
$emulator = Join-Path $androidSdkRoot 'emulator\emulator.exe'

& $emulator -avd $avdName
& $adb kill-server
& $adb start-server
& $adb devices -l
& $adb -s $deviceSerial shell getprop sys.boot_completed
```

判断口径：

- `emulator-5554 device` 这类输出说明设备已被 `adb` 识别。
- `sys.boot_completed=1` 比 emulator 控制台噪音日志更可靠。
- 若 `adb devices` 正常但系统层仍未启动完成，继续等待，不要先改构建链。

### 2. 先让 Tauri 产出 Android Rust 产物

```powershell
$repoRoot = '<repo-root>'
$androidSdkRoot = '<android-sdk-root>'
$javaHome = '<android-studio-jbr>'
$abi = '<abi>'

$env:ANDROID_HOME = $androidSdkRoot
$env:ANDROID_SDK_ROOT = $androidSdkRoot
$env:JAVA_HOME = $javaHome

Set-Location $repoRoot
bun run tauri android build --debug --target $abi
```

判断口径：

- 这一步即使最终在 `jniLibs` symlink 处失败，也不要立刻判死。
- 先检查 `<cargo-target-root>\<abi>-linux-android\debug\libexomind_lib.so` 是否已产出，再决定是否继续走手工同步链路。

### 3. 手工同步 `.so` 与 `tauri.conf.json`

```powershell
$repoRoot = '<repo-root>'
$cargoTargetRoot = '<cargo-target-root>'
$abi = '<abi>'

Copy-Item `
  (Join-Path $cargoTargetRoot "$abi-linux-android\\debug\\libexomind_lib.so") `
  (Join-Path $repoRoot "src-tauri\\gen\\android\\app\\src\\main\\jniLibs\\$abi\\libexomind_lib.so") `
  -Force

Copy-Item `
  (Join-Path $repoRoot 'src-tauri\\tauri.conf.json') `
  (Join-Path $repoRoot 'src-tauri\\gen\\android\\app\\src\\main\\assets\\tauri.conf.json') `
  -Force
```

这是本轮最关键的构建经验：

- `jniLibs/<abi>/libexomind_lib.so` 不应继续沿用旧产物。
- `assets/tauri.conf.json` 也不能继续沿用旧生成物；若此处残留旧值，很容易形成“包 metadata 已更新，但 WebView 仍是旧版本资源”的混合态。

### 4. 直接组包并跳过 `rustBuild*`

```powershell
$androidSdkRoot = '<android-sdk-root>'
$javaHome = '<android-studio-jbr>'
$repoRoot = '<repo-root>'
$gradleAssembleTask = '<gradle-assemble-task>'
$gradleRustBuildTask = '<gradle-rust-build-task>'

$env:ANDROID_HOME = $androidSdkRoot
$env:ANDROID_SDK_ROOT = $androidSdkRoot
$env:JAVA_HOME = $javaHome

Set-Location (Join-Path $repoRoot 'src-tauri\\gen\\android')
.\gradlew.bat $gradleAssembleTask -x $gradleRustBuildTask
```

复用规则：

- 这条命令里的 ABI task 名称需要与当前目标 ABI 对齐。
- 不要假设前一步 `tauri android build` 注入过的环境变量会自动保留到新的 shell；若直接运行 `gradlew` 报 `SDK location not found`，优先检查 `ANDROID_HOME / ANDROID_SDK_ROOT / JAVA_HOME` 是否在当前 shell 里重新设置。
- 目标不是“让 Gradle 重新替你跑 Rust”，而是复用上一步已经确定正确的 `.so` 与前端资源。

### 5. 覆盖安装 APK

```powershell
$repoRoot = '<repo-root>'
$androidSdkRoot = '<android-sdk-root>'
$deviceSerial = '<device-serial>'
$abi = '<abi>'
$adb = Join-Path $androidSdkRoot 'platform-tools\adb.exe'

& $adb -s $deviceSerial install -r `
  (Join-Path $repoRoot "src-tauri\\gen\\android\\app\\build\\outputs\\apk\\$abi\\debug\\app-$abi-debug.apk")
```

### 6. 启动 APK 并接入调试桥

```powershell
$androidSdkRoot = '<android-sdk-root>'
$deviceSerial = '<device-serial>'
$bridgePort = '<bridge-port>'
$rtPort = '<rt-port>'
$adb = Join-Path $androidSdkRoot 'platform-tools\adb.exe'

& $adb -s $deviceSerial shell monkey -p com.exomind.app -c android.intent.category.LAUNCHER 1
& $adb forward tcp:$bridgePort tcp:$bridgePort
& $adb forward tcp:$rtPort tcp:$rtPort
& $adb forward --list
```

随后再启动 Tauri MCP：

```text
driver_session start --host 127.0.0.1 --port <bridge-port>
```

判断口径：

- `driver_session` 成功不代表产品逻辑一定正确，但至少说明 Android 侧 bridge 已可调试。
- `rt-port` 必须来自当前现场真值；旧报告里的端口不能直接复用。

## Android 验收要分三层记录

### 1. 前端 / WebView 真值

优先使用：

- `webview_dom_snapshot`
- `webview_find_element`
- `webview_execute_js`
- `webview_screenshot`

用途：

- 确认当前路由、页面状态、Android-only 控件是否真的出现在运行包里。
- 确认“设置页看到的版本文案”这类前端展示态，而不是只看 APK 包信息。
- 若 `webview_dom_snapshot` 或 `webview_find_element` 在 Android 上超时或报 bridge 兼容性错误，优先退回 `webview_execute_js`：
  - 直接读取 `window.location.href`
  - 直接读取 `document.body.innerText`
  - 必要时截取目标关键词附近的上下文片段

### 2. Android 系统真值

常用命令：

```powershell
$adb='...\\platform-tools\\adb.exe'
& $adb -s <device-serial> shell dumpsys activity activities
& $adb -s <device-serial> shell dumpsys window windows
& $adb -s <device-serial> shell dumpsys alarm
& $adb -s <device-serial> shell dumpsys notification --noredact
& $adb -s <device-serial> shell dumpsys package com.exomind.app
& $adb -s <device-serial> logcat -d -v time
```

用途：

- `dumpsys window`：核对 `KEEP_SCREEN_ON`
- `dumpsys alarm`：核对结束提醒是否真的被系统调度
- `dumpsys notification`：核对是否真的发出时间块结束通知
- `dumpsys package`：核对 APK 版本真值
- `logcat`：核对 Android 插件命令是否真的被调用

### 3. 系统策略真值

这一层用于判断“产品链路已执行，但 OS 是否允许最终行为发生”。

典型例子：

- Android 14 + `targetSdk=36` 下，后台自动拉起 Activity 可能被 `BAL_BLOCK` 拦截。
- 因此“没有真的回到前台”不等于“产品根本没触发自动回开链路”。

## 本轮功能判定

| 能力 | 判定 | 硬证据 | 说明 |
| ---- | ---- | ------ | ---- |
| 专注页保持亮屏 | 通过 | WebView 中出现 `new-focus-keep-awake-button`；`dumpsys window` 出现 `KEEP_SCREEN_ON` | 已确认进入真实窗口 flags |
| 后台结束提醒 | 通过 | `scheduleEndAlert` 日志、`dumpsys alarm`、`dumpsys notification` | 通知链路已真实触发 |
| 后台结束自动回前台 | 部分通过 | `ACTION_TIMEBLOCK_END_ALERT_OPEN_FOCUS` 日志存在，但系统给出 `BAL_BLOCK` | 原生链已执行，最终行为被 OS 拒绝 |
| 设置页版本展示 | 初次验证未闭环，后续已关闭 | 初次验证时 backend state 已是 `0.4.10`，设置页仍显示 `0.3.6`；后续复测已显示 `0.4.10` | 初次问题来自前端 fallback，不应误判成旧 APK |

## 常见误判

### 误判 1：看到 emulator 噪音日志，就断言 AVD 启动失败

更稳的判断应该是：

- `adb devices -l`
- `getprop sys.boot_completed`

### 误判 2：看到设置页 `版本 0.3.6`，就断言 APK 还是旧包

本轮复测后更稳的判断应该分成两层：

- `dumpsys package` / `ipc_get_backend_state` 用来判定后端与包版本真值
- 设置页“关于”文案只代表前端展示态

若前者已是 `0.4.10`，后者仍是 `0.3.6`，优先怀疑前端 fallback，而不是先怀疑 APK 没刷新。

### 误判 3：沿用历史 RT 端口

本轮真值是 `127.0.0.1:9124`，但这不意味着下一轮仍然是同一个端口。历史文档只能提供样例，不能替代现场探测。

### 误判 4：自动回前台失败，就断言 Android 原生链没执行

若 `logcat` 已出现：

- `TIMEBLOCK_END_ALERT_OPEN_FOCUS`
- `cmp=com.exomind.app/.MainActivity`
- `BAL_BLOCK`

则更准确的结论是：

- 原生链已执行
- 最终行为被 Android 系统策略拦截

### 误判 5：重新安装同版本 APK 后，只看 `versionName` 就断言没装进新包

当这轮改动没有 bump 版本号时，`versionName` 可能保持不变。

更稳的判断应该至少同时看：

- `adb install -r` 是否成功
- `dumpsys package com.exomind.app` 中 `lastUpdateTime` 是否刷新
- 目标前端或原生行为是否真的变化

## 阶段补记：关于页版本 fallback 修复复测（2026-04-16 晚间）

### 本轮目标

- 验证设置页“关于 > 版本”不再错误显示旧的 `0.3.6` fallback。
- 把这轮实测里新增的构建、验证与收尾经验沉淀成可复用规则。

### 本轮观察结果

- AVD 可直接复用：
  - `adb devices -l` 仍能看到 `emulator-5554`
  - `getprop sys.boot_completed=1`
- `bun run tauri android build --debug --target x86_64` 仍会在 Windows symlink 限制处失败，但在此之前：
  - 前端 `dist/` 已完成更新
  - Android Rust `.so` 已完成编译
- 手工 `gradlew :app:assembleX86_64Debug -x rustBuildX86_64Debug` 第一次在新 shell 中失败，报：
  - `SDK location not found`
- 同一命令在补上以下环境变量后恢复成功：
  - `ANDROID_HOME`
  - `ANDROID_SDK_ROOT`
  - `JAVA_HOME`
- `adb install -r` 覆盖安装成功后，`dumpsys package com.exomind.app` 显示：
  - `versionName=0.4.10`
  - `lastUpdateTime` 已刷新
- Android 上的 Tauri MCP `driver_session status` 可正常连上，但：
  - `webview_dom_snapshot` 这轮出现脚本超时
  - `webview_find_element` 这轮出现 bridge 解析错误
- 更稳的验证路径是直接用 `webview_execute_js`：
  - 读取 `window.location.href`
  - 读取 `document.body.innerText`
  - 截取 `版本` / `构建` 附近上下文
- 通过这条路径，在真实 AVD 里确认设置页“关于”文案已变为：
  - `版本 0.4.10`
  - `构建 dev`
- 收尾时，先关闭 Tauri MCP session，再执行：
  - `adb -s emulator-5554 emu kill`
- AVD 关闭的更稳判据不是只看其中一层，而是同时确认：
  - `adb devices -l` 已为空
  - Windows 上已无 `emulator.exe` 进程

### 本轮结论

- 设置页“关于”显示旧版本号的问题已经通过真实 Android AVD 复测关闭。
- 之前的 `0.3.6` 不是“APK 还是旧包”的证据，而是前端 fallback 过期；修复后，真实 APK 中的设置页文案已与当前版本对齐。
- 对 Android 上的 Tauri MCP，不要把 `DOM snapshot` 当唯一入口：
  - `execute_js + innerText/context` 在这轮更稳定，也足以完成设置页类验收。
- 对“同版本号重装 debug APK”的验证，不要只看 `versionName`：
  - 更应看 `lastUpdateTime`
  - 更应看目标行为是否变化

### 可复用操作套路

1. `tauri android build` 与 `gradlew assemble` 视为两条独立命令链。
   - 换 shell 后，重新显式设置 `ANDROID_HOME / ANDROID_SDK_ROOT / JAVA_HOME`。
2. 若 `adb install -r` 装的是同版本号 debug 包，安装后立刻回读：
   - `dumpsys package com.exomind.app`
   - 重点记录 `lastUpdateTime`
3. 若 Android 上 `webview_dom_snapshot` 不稳，不要卡住：
   - 直接切 `webview_execute_js`
   - 用 `body.innerText` 和关键词上下文做 UI 真值判定
4. 做 AVD 收尾时，至少同时确认两层：
   - `adb devices -l` 为空
   - `Get-Process emulator` 不再返回任何进程

## 后续跟进

- 把“同步 `.so` + 覆盖 `assets/tauri.conf.json` + `gradlew -x rustBuild*`”固化成脚本，而不是只留在人工命令里。
- 若产品仍要求后台结束自动回前台，需要专门研究 Android 14 / `targetSdk=36` 的 BAL 约束，不要继续把问题归到 emulator、bridge 或 APK 脏态。

## 最小复用清单

1. 先确认当前 AVD、设备序列号、ABI、RT 端口、bridge 端口真值。
2. 统一使用 SDK 自带 `adb.exe`，不要混用系统 PATH 里的旧 `adb`。
3. `bun run tauri android build` 后先检查 `.so` 是否产出，不要因为 symlink 失败就直接放弃。
4. 必须同步两类产物：
   - `jniLibs/<abi>/libexomind_lib.so`
   - `assets/tauri.conf.json`
5. 组包优先走 `gradlew ... -x rustBuild*`，避免再回到不稳定的 Tauri 生成链。
6. 验收结论至少同时写清：
   - WebView 真值
   - Android 系统真值
   - 系统策略真值
