# 开发脚本使用约定

按[脚本入口](README.md)和[仓库 Agent 合同](../AGENTS.md)选择工具。从仓库根执行 README 中的 Bun 命令。PowerShell 工具的参数、SDK 路径和平台范围以各脚本与 `scripts/_shared/config.ps1` 为准。涉及长时构建或测试时按[Windows 有限命令监督合同](dev/supervised-command-contract.md)管理本次任务及其日志。
