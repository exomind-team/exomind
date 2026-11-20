# 固定 Core10 历史输入

`scripts/dev/beta-core10-fixture.ts` 从 recipe `5708e0baf5cdc896559fab5172dc13805531ba33`
提取真实旧 Core 源码；该源码对应 Beta19 payload
`cc3bc937c4196d1a6a838b10a82018dc37d66480`。它编译旧实现并生成合成数据库，
不靠改 `user_version` 或用新模型重新序列化旧记录制造升级输入，不读取用户档案。

```text
node scripts/dev/beta-core10-fixture.ts --out <仓库外、父目录已存在的全新绝对路径>
```

Node 与 Bun 入口均保留。输出拒绝仓库内目录、已有目标、链接与不安全源路径；
每次运行用新目录保留失败证据。编译复用 `CARGO_TARGET_DIR`，Windows 默认复用
`G:/exomind-beta-native-cache`；CI 应显式传入自己的缓存。启动前仍执行项目的磁盘/
内存门禁，有限命令由受控 Job 监督；工具本身的两个 Cargo 阶段各有 15 分钟截止。

标准输出只有结果 JSON，其 `fixture` 指向生成目录。目录中分别保留数据库、SQLite
原始 summary body、领域 digest、snapshot digest 和 manifest；外层 provenance 记录
源文件、生成器和两份 lock 的指纹。原始 BLOB 的 SHA 与领域 digest 是不同校验对象，
不能互相替代。每个 Cargo 阶段的 stdout/stderr 写入本次输出目录；失败不覆盖既有证据。

隔离 crate 只允许裁掉不相关 workspace lock 项，保留的依赖版本、来源和 checksum
必须与旧 lock 相同。原 Core8 工具及公共导出名继续保留，使用同一提取/lock 校验边界。

升级测试应把此 fixture 作为只读输入，复制后交给新 Core 打开，并检查事实 BLOB、
领域 digest、原 local sequence、回执和身份。新库可建立索引，不能改写旧摘要或借用
fixture 身份运行新设备。升级成功与 peer schema 兼容是不同判断，后者仍须单独协商。
