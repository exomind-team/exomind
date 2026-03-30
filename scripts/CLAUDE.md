# 脚本系统使用指南

大模型快速调用参考。

## 快速调用

### 构建

```
请构建桌面端
→ 执行 scripts/build/desktop.ps1

请构建 Android
→ 执行 scripts/build/android.ps1

请全平台构建
→ 执行 scripts/build/all.ps1
```

### 开发

```
启动桌面端开发
→ 执行 scripts/dev/desktop.ps1

启动 Android 开发
→ 执行 scripts/dev/android.ps1

显示全部开发启动命令
→ 执行 scripts/dev/all.ps1
```

### 测试

```
运行单元测试
→ 执行 scripts/test/unit.ps1

运行全部测试
→ 执行 scripts/test/all.ps1
```

## 多实例开发管理器（tauri:manager）

同时管理多个 Tauri dev 实例（桌面+Android），自动分配端口，避免冲突。

### 启动

```bash
# 启动桌面端
bun tauri:manager start --name desktop

# 启动 Android 端（需要模拟器或真机已连接）
bun tauri:manager start --name phone --target android

# 指定端口
bun tauri:manager start --name desktop --web-port 1420
```

### 管理

```bash
# 查看所有实例
bun tauri:manager list

# 查看日志
bun tauri:manager logs --name phone --tail 20
bun tauri:manager logs --name desktop --follow

# 停止实例
bun tauri:manager stop --name phone

# 清理已退出的实例记录
bun tauri:manager prune
```

### 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--name <name>` | 实例名称 | `<target>-<port>` |
| `--target desktop\|android` | 构建目标 | `desktop` |
| `--web-port <port>` | Vite 前端端口 | 自动分配 |
| `--hmr-port <port>` | HMR 端口 | 自动分配 |
| `--watch` | 启用文件监视 | 关闭 |

### 日志与数据

- 实例元数据: `.tmp/tauri-dev-instances/<name>.json`
- 构建日志: `.tmp/tauri-dev-instances/<name>.log`

---

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

- 所有脚本从 `scripts/` 目录执行
- 脚本支持 `-NoInstall` 跳过依赖安装
- 构建脚本接受 `-SkipDesktop`, `-SkipAndroid` 参数
- 测试脚本返回退出码 0=成功, 非0=失败
- 共享配置位于 `scripts/_shared/config.ps1`

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
