# ExoMind 开发脚本

从仓库根目录按要验证的目标选择入口。应用版本、候选锁与 CI 对应关系见[版本状态](../docs/AI-CONTEXT.md)。

| 目标 | 执行入口 | 可核对的结果 |
|---|---|---|
| 运行 Beta 前端或独立 Host | 按[快速上手](../docs/development/quickstart.md)启动合成档案或新的测试根 | 合成 UI 状态、Host 身份、档案内实际回执分别核验 |
| 生成 0.6 Beta 原生候选 | [Beta Build Validation](../.github/workflows/beta-build-validation.yml)读取[候选锁](../.github/beta-build-candidate.json)，通过 [Beta build request](dev/beta-build-request.ts)校验源码 | 对应平台的 build-info、版本、源码 SHA 与制品摘要，具体操作见[构建指南](../BUILD.md) |
| 在 Windows 上监督有限时长的验证 | [监督器及命令格式](dev/supervised-command-contract.md) | 同一 run 的终态、退出码和自有 Job 清理结果 |
| 准备 Android 构建与安装验证 | [Android 生成目录准备器](dev/beta-android-prepare.ts) · [Windows 上的 Android 验收](../docs/development/tauri-android-windows-playbook.md) | 目标 ABI、包名、签名与实际设备结果 |
| 运行 Web 与契约回归 | `bun run test --run tests/unit/beta/dev-mock-profile.test.ts`；其他入口见 [package.json](../package.json) 和 [Beta 回归合同](../docs/development/beta-iteration-guards.md) | 选中的用例名、实际执行数和故障所属层 |
| 管理传统 Tauri dev 实例 | `bun run tauri:manager -- list`，按管理器登记的实例名称查看日志和停止自有任务 | 记录中的 PID、日志和实际监听情况；参数见[管理器](dev/tauri-dev-manager.ts) |
| 维护仓库评论与公开发布 | [GitHub 评论工具](dev/github-comment.ts) · [协作与发布约定](../docs/development/repo-agent-workflow.md) | 按任务授权执行，有外发动作时核对目标及线上结果 |

## Windows PowerShell 工具

[构建脚本](build/)、[开发脚本](dev/)和[测试脚本](test/)保留各自的参数。`build/all.ps1` 编排 Windows 桌面与 Android 两端。各端构建环境从[共享配置](./_shared/config.ps1)读取，需与本机实际 SDK/JDK 路径相符。Beta 验证采用上表指定的 feature、配置与候选工作流。
