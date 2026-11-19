# Beta 本机资源诊断

当前是冻结Beta16之后的后台增量；Native入口和用户面板按
[持续完成计划](../plans/2026-11-19-beta16-frozen-and-beta-completion.md)分别验收。
它不启动后台采样、远端上传或目录自动清理，也不代表设备耗电根因已经查明。

## 所有者与数据口径

`exomind_beta_host::diagnostics::process::ProcessDiagnosticsCollector`由调用方持有，
显式`sample()`才读取当前进程。Native/Host主进程范围不包含WebView/GPU或整机总量。
CPU由真实累计user+kernel时间与单调时间差计算，`usageCores=1`表示一个逻辑CPU满载；
首样、身份变化、计数/时钟回退均为未知，不填零。工作集/RSS与专用提交内存分开，
各字段有单位、可用性和有限原因。Windows、Linux/Android的采集适配独立；其他平台明确不支持。

所有纳秒JSON字段使用十进制字符串，Rust内部仍用整数：`monotonicElapsedNs`、
`cpu.cumulativeTime.value`、`cpu.measurementWindow.value`、存储`elapsedNs`。
未知metric的value仍为null；字节/计数/墙钟ms保留数值。JS不得先将这些纳秒串转Number
再声称精确；趋势图可派生近似坐标，原始报告保留原串。

`storage::scan_host_storage`只遍历Native提供的Host私有根，不接受界面传入路径。
它只读目录与no-follow metadata，不读正文/BLOB、不进入Core事务门，不序列化路径、
文件名或任意OS错误。默认4096条目/文件、256目录、64GiB逻辑字节、250ms；
可配置范围还有硬上限。取消/权限/预算/缺条目返回partial，计数为已观察下界；
不将逻辑字节称为占用磁盘块、可释放空间或全设备总量。

取消和耗时预算在OS调用之间合作式检查，不能抢占已开始的同步OS调用。
Windows拒绝reparse/junction，Unix拒绝symlink；路径式遍历不能防御同一用户恶意
并发替换目录的TOCTOU，不能宣称句柄级沙箱。Native只提供应用私有根，扫描须放入
blocking worker，等待时不能持有Host/Core门或控制正常计时/同步/传输的锁。

`scans::StorageScanCoordinator`为一个Native实例管理单一扫描槽。扫描lease在成功、
错误或退出时只释放自己的代次；停止拒绝新扫描并请求取消活动扫描。取消按扫描ID归属，
不会取消另一个活动扫描。尚未开始的ID即使遇到另一活动扫描，也暂存取消意图，避免IPC
调度顺序让关闭面板后的请求稍后重新开始。提前取消和近期完成ID各只保留32项；这是一段
有界恢复窗口，不是永久请求账本。相同已完成ID在窗口内拒绝复用，迟到取消不会重新激活它。

## 回归与证据边界

父代理补充纳秒序列化精度反例，真实2项先红后绿；修正未知目录分类和Windows junction
测试命令的参数转义。Windows诊断24项在模块隔离harness与实际Host crate中均通过，
包含本进程OS采样、预算/取消/未知、junction目标不读取或修改和序列化白名单。
实际Core/Host另有4条来源证明回归通过，验证期间源码指纹未变化。

协调器接入后，父代理先复现“另一扫描运行时丢掉延迟请求的取消”，再修正按ID缓存；
当前Windows完整诊断组34项通过，包含活动/提前/迟到取消、单槽并发和停止。Native命令
注册、Settings生命周期与真实扫描界面仍按集成候选另验，不借后台结果宣称前端已完成。

源码CI另运行诊断与来源证明组，并拒绝零测试的空绿灯。这些结果不替代Native/UI接线、
Linux/Android运行、面板自身开销、物理电池/USB输入或人类连续使用验收。

新增指标时先确定权威OS来源、单位与范围，再进入有界标量DTO；不把其他进程或未知
能力拼成总量。新增目录分类须有真实Host布局依据，未知目录留在未分类；不为展示读取内容。
