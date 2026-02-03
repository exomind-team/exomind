# 脚本系统使用指南

大模型快速调用参考。

## 快速调用

### 构建

```
请构建桌面端
→ 执行 Scripts/build/desktop.ps1

请构建 Android
→ 执行 Scripts/build/android.ps1

请全平台构建
→ 执行 Scripts/build/all.ps1
```

### 开发

```
启动桌面端开发
→ 执行 Scripts/dev/desktop.ps1

启动 Android 开发
→ 执行 Scripts/dev/android.ps1

显示全部开发启动命令
→ 执行 Scripts/dev/all.ps1
```

### 测试

```
运行单元测试
→ 执行 Scripts/test/unit.ps1

运行全部测试
→ 执行 Scripts/test/all.ps1
```

## 开发差异说明

### Windows 桌面端开发
- 在本地运行，无需额外设备
- 前端代码自动热重载
- Rust 代码修改后需要重启

### Android 端开发
- 需要连接 Android 设备或启动模拟器
- 支持热重载和 HMR
- 设备断开后需重新运行

## 脚本契约

- 所有脚本从 `Scripts/` 目录执行
- 脚本支持 `-NoInstall` 跳过依赖安装
- 构建脚本接受 `-SkipDesktop`, `-SkipAndroid` 参数
- 测试脚本返回退出码 0=成功, 非0=失败
- 共享配置位于 `Scripts/_shared/config.ps1`

## 常用参数速查

| 脚本 | 参数 | 说明 |
|------|------|------|
| `build/all.ps1` | `-SkipDesktop` | 跳过桌面端构建 |
| `build/all.ps1` | `-SkipAndroid` | 跳过 Android 构建 |
| `build/all.ps1` | `-InstallAndroid` | 构建后自动安装 |
| `build/desktop.ps1` | `-Clean` | 深度清理 |
| `build/android.ps1` | `-Install` | 自动安装到设备 |
| `build/android.ps1` | `-Release` | 构建发布版 |
| `build/android.ps1` | `-Device <id>` | 指定设备 |
| `dev/desktop.ps1` | `-NoInstall` | 跳过依赖安装 |
| `dev/android.ps1` | `-NoInstallApk` | 不自动安装 APK |
| `test/unit.ps1` | `-Watch` | 监视模式 |
| `test/unit.ps1` | `-Coverage` | 生成覆盖率报告 |
| `test/all.ps1` | `-SkipUnit` | 跳过单元测试 |
| `test/all.ps1` | `-SkipIntegration` | 跳过集成测试 |
