# next/ 开发边界

这是隔离的迁移候选。父仓规则仍适用；用户本轮确认的范围见 docs/DECISIONS.md。

先读 README、DECISIONS、API、SECURITY、LOCAL_CODEX_HANDOFF 与 TASKS。不擅自改变旧版数据库、启动命令、版本/标签或正式发布流程。修改同一责任时同时检查所有写入者、异步结果和恢复路径。

不可退化的行为：事务回执；稳定重试 ID；读取失败不变空；离线不删除配对；端点不等于身份；metadata 与 blob 完成分开；取消后禁止迟到结果提交；原文不被总结覆盖；用户生活/休息不被强制当成生产任务。

正常修改完成后执行 npm run verify；修改 Python 提供者再执行其 unittest。浏览器、WinCraft、Windows、Android、EasyTier 和真实模型分别验收；不能把某层通过扩写成另一层通过。所有试验使用新建合成目录；用户日用数据需独立授权与备份。

公共 API 变更同步 docs/API.md 与 skills/exomind-next-access/SKILL.md。新协议变更与数据库版本必须有明确迁移或拒绝规则。不要用 TS 类型声明冒充 JS 源码已被全面静态检查。
