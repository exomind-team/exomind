# Beta Android 原声权限

WebView 录音需要 Manifest 声明 `RECORD_AUDIO` 和 `MODIFY_AUDIO_SETTINGS`。
声明由维护源 `scripts/dev/beta-android-prepare.ts` 在 fresh init 后补齐；不依赖手改
被忽略的生成目录。准备器接受已核对的 CLI 模板及 CI 预处理结果，重复运行不重复加权限，
陌生结构、权限或属性会明确失败。此操作不负责安装、运行时授权或启动录音。

本机锁定 Tauri 2.10.3 / Wry 0.54.3 的 Android 实现已通过 WebChromeClient 处理
运行时许可：音频 capture 才申请麦克风，视频 capture 才涉及摄像头。Beta 原声控制器
只在用户显式开始时请求音频，不增加摄像头或广泛存储请求。许可迟到后已取消的 session
释放其自有 tracks；拒绝、无设备和设备忙各有恢复状态，不等同于用户停止。

该功能没有新增后台常驻录音服务。前台内切页与 Android 系统限制后台麦克风分别验收，
不能把系统授权成功写成录音已编码或原声已可靠保存。

准备器及 CI 接缝 26 项单测、定向严格 TypeScript 检查通过，仍保留绝对 Node/Tauri
回调、唯一固定 NDK30 与双 ABI 规则。冻结 Beta16 的来源和二进制未改变。
下一候选需检查 merged APK 的最终权限，实际走允许／拒绝／撤销，再用合成音核对
编码、草稿接纳与保留数据升级；物理设备/OEM行为和系统后台策略另记。
