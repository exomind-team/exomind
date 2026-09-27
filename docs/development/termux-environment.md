# Termux 平台基线

> 本页只记录 ExoMind 开发者需要知道的通用 Termux/Android 约束。完整的跨项目知识库位于私有仓库 [`ARCJ137442/sys_manage_termux`](https://github.com/ARCJ137442/sys_manage_termux)；本页不复制其中全部内容，也不替代 ExoMind 自身的应用运行文档。
>
> 复核日期：2026-09-27。版本、命令和限制以当前设备实测为准，旧经验需要重新验证。

## 工具链基线

在当前设备确认工具链，而不是把别的机器版本当作最低要求：

```sh
pkg update
pkg upgrade
pkg install git curl nodejs rust tmux
node --version
npm --version
rustc -vV
cargo -vV
```

`pkg upgrade` 会更新 Termux 用户态包，应在电量和网络稳定时执行。项目依赖安装优先遵循项目锁定的包管理器；若 proot/Termux 中 Bun 出现权限或文件复制异常，可用 npm 做对照，并把工具、版本和结果记录为现场证据。

## Termux 路径和文件系统约束

- 使用 `$TMPDIR` 写临时文件和日志，不假定 `/tmp` 可写。
- 通过 `termux-setup-storage` 获取共享存储权限时遵循最小权限；共享存储与应用私有目录不是同一边界。
- 遇到 `ENOSPC`，先缩小文件 watcher 范围，排除 `node_modules`、Rust `target`、日志和测试报告，再判断是否确实需要系统级额度调整。
- Native addon 可能需要 Android ABI、编译器或系统库；`npm install --ignore-scripts` 可以绕过安装脚本，但也可能让依赖只具备部分功能，必须在 ExoMind 的实际路径上验证。

## proot、资源和可恢复运行

proot 会改变路径、动态链接器、DNS 文件和权限表现。记录兼容层入口、环境变量和原生路径对照，不要把一次 proot 成功外推为所有二进制兼容。

Rust/Node 构建遇到内存压力时，先观察 `MemAvailable`、Swap 和磁盘，再降低并行度；构建产物必须在目标 ABI 上做最小运行检查。需要跨息屏或切换应用的长任务可放进命名 tmux 会话，但 tmux 不能阻止 Android 清理进程。

## 后台稳定性

Android 可能因为电池优化、内存压力、后台策略或 Phantom Process 限制杀掉 Termux 子进程。先检查应用电池策略、系统日志、内存和存储，再考虑开发者选项或 ADB。全局系统设置要记录原值、权限、副作用和恢复方法；不要把某个设备上的高上限或关闭监控命令写成默认修复。

## 浏览器和剪贴板适配

Termux 上的浏览器测试可能需要系统 Chromium，并通过环境变量覆盖实际可执行路径；`--no-sandbox` 等参数必须只在受控测试中使用并记录安全边界。图形桌面的 `wl-copy`/`xclip` 与 Android 的 `termux-clipboard-*` 不是同一接口，桥接时要检测命令、处理失败并避免记录剪贴板内容。

## 证据纪律

记录现场时标注“实测 / 源码或文档 / 推断”和日期，只保留退出码、状态码、错误类别、版本和脱敏路径。不要把 API key、认证文件正文、完整会话日志、设备序列号或私人凭据写进仓库。

项目的应用启动、端口、Runtime、数据库、Tauri/Android 联调和健康检查仍以 ExoMind 对应文档为准，不在本页重复。Termux 平台问题优先回到 [`sys_manage_termux` 知识库](https://github.com/ARCJ137442/sys_manage_termux)。
