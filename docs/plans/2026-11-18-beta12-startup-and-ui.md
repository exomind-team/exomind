# Beta12：Windows 启动恢复与 UI 评审落地

> 2026-11-18。用户报告 `8235fa0a` 的 Beta11 Windows EXE 双击立即退出，关闭0.5.1仍相同；随后明确要求构建Beta12、包含本轮UI，并指定GPT-6.2 Astra high独立盲审。当前分支dev-0.6，起点c8f79e27，无新worktree。

## 已确认的启动故障

- 原EXE SHA256仍为 `7ecfea911b24aaec1c50254e632fea60b0331101f9cfbaa86928450d7bc255a6`，没有损坏或被本轮Web修改覆盖。
- 默认Beta资料目录的只读文件名清单包含`desktop-preferences.beta.json`。Native桌面设置写入该文件，但Host根目录归属清单遗漏它；再次打开时在Core迁移前返回`ForeignRoot`，Tauri setup panic，GUI没有可用错误说明。
- 隔离控制：原EXE使用新建合成Host目录，进程存活到30秒观察期限；在同一合成目录加入正确格式的桌面偏好后，原EXE退出101，stderr为`Failed to setup app ... the root belongs to another application`。这确认一个可重复的启动缺陷，不把用户所有潜在退出情况归为同一原因。
- 没有清空、改名或重建用户资料，没有打开用户Host凭据或让真实模型任务运行；0.5.1实例未操作。

## 修复与回归

Host与Native共享桌面偏好文件名和临时文件命名合同。已初始化的Host接受这个可选设置文件，以及严格匹配UUID格式的原生写入临时文件；未知相近文件名、未建立Host归属的目录仍拒绝。设置内容的校验/恢复仍由Native设置拥有，损坏偏好不改写记录库。

Windows Host初始化失败时先记录原因并显示系统错误对话框，说明资料保留、下一步和日志位置；在WebView/事件循环尚不可用时直接使用已有Windows API，不依赖阻塞的Tauri Dialog回调。受阻时仍拒绝打开，不用空档案掩盖错误。

`host-red-b`新增两项回归先失败；`host-green`完整Host集成14项通过，涵盖正常/损坏偏好重开、设备/档案/事实/回执保值、残留临时文件、外来根拒绝，以及原认证/退出/权限检查。`native-check`Beta配置下Rust检查通过，`typecheck`通过。

## 独立 UI 评审

见[Astra盲审](../research/2026-11-18-beta-ui-astra-blind-review.md)。评审先封存十二张画面的初见判断，再核固定c8f79e27源码及官方参照；不是人类审美批准，也不是Beta12真机验收。

当轮采纳两项P1：

1. 用户气泡暖橙底调整为`#B24D2F`，草稿/本机保存状态使用强文本角色；按浏览器实际计算样式及不透明底色核普通文本至少4.5:1。此范围通过不代表整套无障碍认证。
2. 空闲入口的可见名称与可访问名称统一为「配置时间块」，确认按钮为「开始计时」。实际鼠标/触摸/键盘路径核取消零次开始，确认恰好一次；不再靠测试ID掩盖标签分歧。

`ui-unit`：52文件337项通过；`ui-browser-b`：四组Edge桌面浅/深、手机/平板触摸仿真共20项通过。首轮测试脚本的中文定位字符串经PowerShell管道变成问号，该轮取消并保留；修正编码后重跑通过。短屏密度、信息架构、真实IME/触摸、性能成本等P2/人审项保留，未整页擅自改版。

## Beta12 候选与后续验收

`tauri.beta.conf.json`改为0.6.0-beta12/6012，独立包名不变，Core8/Host auth5/sync2不变；手动CI默认版本同步，但不运行公开Release/Pages或移动旧标签。候选须从冻结提交构建，Windows与ARM64保持同源；旧Beta11失败候选不覆盖。

候选源码冻结为`a244f5675ea387cf48e4c33077d7dda29b780200`并已立即推送；本轮包含c8f79e27的工作区显隐、内联图片及反馈快捷键，以及本记录的启动/两项UI修复。后续交付记录提交不作为二进制源码。

| 交付 | 文件与结果 |
| --- | --- |
| Windows x64 | `G:/exomind-deliverables/0.6.0-beta12/a244f5675ea3/windows/ExoMind-0.6.0-beta12-windows-x64.exe`，66432512字节，SHA256 `4af4c404a3b3579dbcc5338602c0a1cc3b7c43ed3ba9965b06987aed7442675a`。PE GUI子系统2，Product/FileVersion均0.6.0-beta12；Web8.81秒、Rust60秒，正常0/清理确认。 |
| Android arm64 | 同源`android/ExoMind-0.6.0-beta12-arm64-v8a.apk`，108534089字节，SHA256 `4a5307ac5045b461db2cf9a813a0505e0c8baad8a4136b15ae4abfbaa330fa66`。包名com.exomind.app.v06.beta、6012/Beta12、arm64-v8a、debuggable；V2验签通过，证书SHA256 `768f3a1338da7e8d62abb93f3e124b472db5645f1338e221b9a497e42583ec80`与Beta10相同。 |

Android Web8.64秒/Rust67秒后在已知Windows symlink权限边界停止，失败保留且Job已清理。核对fresh ARM64 ELF/未解析符号后复制到jniLibs，独立单路Gradle80秒完成；未改变系统权限。核验报告和SHA256SUMS写交付目录，未创建Release/tag/Pages；旧Beta11原件hash再次核对未变。

`native-smoke`使用原Beta11反例的同一合成Host根，两次实际启动/优雅退出均0：通过Native IPC确认根目录、Host运行与打包Beta12界面；保存新记录、桌面快捷键/快速聚焦设置后退出，再启动确认设备身份、原回执、记录正文与设置均保留。两次Tauri MCP截图分别为`native-phase-1/window.png`与`native-phase-2/window.png`，父代理已查看真实渲染。没有打开用户真实Beta档案或触发模型调用；这不计真实用户档案升级验收。

`popup-smoke-b`实际观察Windows启动错误对话框、保留资料说明，并确认拒绝未知根后sentinel和目录条目未变。应用按预期错误101退出；外层验收脚本正常0/Job清理确认。首轮脚本假定确认按钮ID=1失败，改为关闭已核PID/标题的同一原生对话框后复验；未把夹具按钮定位失败写成产品缺陷。

Android设备未连接，APK尚未现场安装；保留数据升级、同版多端同步/时间块/原件与能耗仍待。Core8不能由旧Core7程序直接打开；多端复测使用同版Beta12，不清库或卸载来掩盖问题。

原始证据：`G:/exomind-runs/beta12-startup-20261118-a/`，不提交日志、截图、配置、数据库或构建产物。所有重型操作串行、单任务低优先级、lld单路链接；首次Host红例编译按资源规范切换后取消，后续run有独立终态/清理记录。
