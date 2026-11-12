# 实现来源与验证来源

## 用户事实

2026-11-10 用户上传的脱敏本地交接包：00 交接说明、01 意图与用途、02 设备同步实况、03 系统现况、04 来源核对。本包不复制其中的本机清单、原始记录或路径，需求映射见 DECISIONS。

## 已核对仓库

- exomind-team/exomind：dev 固定提交 `ddb1ba1a6c1e0760af77b55d5659df44ad253b34`；AGENTS、vision、principles、AI-CONTEXT、runtime-agent-contract。
- exomind-team/arc137-dev-standard：通用原则、JS/TS、表现层、Python 相关章节；用于边界与维护性，不代表已做人工接管试验。
- exomind-team/arc-ui-design：新界面、层级与真实反馈相关材料。
- exomind-team/WinCraft：examples/python 目录与 exomind_readonly.py；复用 Client 的公开调用形态，未读取并测试整个当前客户端。

## 公共技术资料

- Node v22.16 SQLite API：`https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html`
- Node HTTPS API：`https://nodejs.org/api/https.html`
- DeepSeek Chat Completions 参考：`https://api-docs.deepseek.com/api/create-chat-completion`

具体运行行为以包内代码和测试为准。兼容协议参考不等于完成真实厂商联调；Node 内置 SQLite 在本次环境仍报告实验性警告。

## 证据目录

源树只保留证据摘要。交付 ZIP 的 validation/ 保留本轮最终测试日志及环境说明，不含用户资料、访问密钥、数据库或测试生成的私钥。
