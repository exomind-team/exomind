# Termux 环境开发指南

> 在 Android Termux 环境下编译和运行 ExoMind 的完整指南

## 概述

ExoMind 支持在 Termux 环境下以 Web 版模式运行，采用前后端分离架构：
- **前端**：Vite 开发服务器（端口 1420）
- **后端**：exomind-rt Runtime 服务（端口 1949）

这种方式避开了 Tauri 在 Android 上的交叉编译复杂性，直接在 Termux 原生环境运行。

---

## 环境要求

### 工具链版本

| 工具 | 最低版本 | 推荐版本 | 说明 |
|------|---------|---------|------|
| Node.js | 18.x | 25.3.0+ | JavaScript 运行时 |
| npm | 9.x | 11.10.0+ | 包管理器 |
| Rust | 1.70+ | 1.93.1+ | Rust 编译器 |
| Cargo | 1.70+ | 1.93.1+ | Rust 包管理器 |

### 安装工具链

```bash
# 更新 Termux 包管理器
pkg update && pkg upgrade

# 安装 Node.js 和 npm
pkg install nodejs

# 安装 Rust 工具链
pkg install rust

# 验证安装
node --version
npm --version
rustc --version
cargo --version
```

---

## 关键约束与解决方案

### 包管理器选择

**问题**：Termux/proot 环境下 bun 有系统性权限问题，导致 `@types/*` 和 typescript 核心文件变成空目录。

**解决方案**：必须使用 npm

```bash
# ❌ 错误做法
bun install

# ✅ 正确做法
npm install --ignore-scripts
```

### 文件系统限制

| 限制 | 说明 | 解决方案 |
|------|------|----------|
| `/tmp` 无写权限 | 日志/临时文件写入失败 | 使用 `$TMPDIR` 环境变量 |
| inotify 监视器上限 | Vite 启动报 ENOSPC 错误 | `vite.config.ts` 中 `watch.ignored` 加入大目录（如 `**/target/**`） |
| proot 权限映射 | bun 文件拷贝失败 | 改用 npm |

### Native Addon 编译

**问题**：部分依赖（如 `better-sqlite3`）需要编译 native addon，在 Termux 环境下可能失败。

**解决方案**：使用 `--ignore-scripts` 跳过编译

```bash
npm install --ignore-scripts
```

**影响**：
- `better-sqlite3`（pouchdb 间接依赖）编译会失败
- 不影响前端开发（前端使用 IndexedDB）
- 如需 PouchDB Node.js 端存储，需单独处理 native addon

---

## 完整编译流程

### 1. 克隆仓库

```bash
git clone https://github.com/exomind-team/exomind.git
cd exomind
git checkout dev
```

### 2. 安装前端依赖

```bash
# 清理旧依赖（如果存在）
rm -rf node_modules package-lock.json

# 安装依赖（跳过 native 编译）
npm install --ignore-scripts
```

**如果 TypeScript 核心文件缺失**：

```bash
# 手动修复 TypeScript
npm pack typescript@5.6.3
tar -xzf typescript-5.6.3.tgz
cp -r package/* node_modules/typescript/
rm -rf package typescript-5.6.3.tgz
```

### 3. 编译后端

```bash
# 编译 exomind-rt（约 3 分钟）
cargo build --bin exomind-rt --release

# 验证编译产物
ls -lh target/release/exomind-rt
# 预期输出：-rwx------. 1 u0_a262 u0_a262 3.1M ...
```

---

## 运行服务

### 启动前端（Vite 开发服务器）

```bash
# 前台运行（查看日志）
npm run dev

# 后台运行（推荐）
npm run dev > $TMPDIR/exomind-vite.log 2>&1 &
```

**访问地址**：
- 本地：http://localhost:1420
- 网络：http://<你的IP>:1420

### 启动后端（Runtime 服务）

```bash
# 前台运行
EXOMIND_RT_PORT=1949 ./target/release/exomind-rt

# 后台运行（推荐）
EXOMIND_RT_PORT=1949 ./target/release/exomind-rt > $TMPDIR/exomind-rt.log 2>&1 &
```

**健康检查**：

```bash
curl http://127.0.0.1:1949/health
# 预期输出：{"status":"ok","version":"0.1.0"}
```

### 验证服务状态

```bash
# 检查进程
ps aux | grep -E "(vite|exomind-rt)" | grep -v grep

# 检查前端
curl -I http://127.0.0.1:1420

# 检查后端
curl http://127.0.0.1:1949/agents
```

---

## 常见问题

### Q1: npm install 报权限错误

**症状**：
```
Error: EACCES: permission denied, mkdir '/data/data/com.termux/files/home/A137442/exomind/node_modules/@types'
```

**解决**：
```bash
# 清理并重新安装
rm -rf node_modules package-lock.json
npm install --ignore-scripts
```

### Q2: Vite 启动报 ENOSPC 错误

**症状**：
```
Error: ENOSPC: System limit for number of file watchers reached
```

**解决**：在 `vite.config.ts` 中添加：

```typescript
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/target/**', '**/node_modules/**']
    }
  }
})
```

### Q3: TypeScript 找不到核心库

**症状**：
```
error TS2318: Cannot find global type 'Array'.
```

**解决**：手动修复 TypeScript（见上文"安装前端依赖"章节）

### Q4: exomind-rt 启动报 TS Agent 错误

**症状**：
```
exomind-rt: failed to spawn ts agent `reviewer`: No such file or directory
exomind-rt: failed to spawn ts agent `classifier`: No such file or directory
```

**说明**：这是预期行为，不影响核心功能。`reviewer` 和 `classifier` 是可选的 TypeScript Agent，核心 Rust Agent（claude、echo）已正常运行。

### Q5: 如何查看服务日志

```bash
# 前端日志
tail -f $TMPDIR/exomind-vite.log

# 后端日志
tail -f $TMPDIR/exomind-rt.log
```

---

## 性能优化

### 减少内存占用

```bash
# 限制 Node.js 内存（如果设备内存不足）
NODE_OPTIONS="--max-old-space-size=512" npm run dev
```

### 加速编译

```bash
# Rust 增量编译（默认已启用）
export CARGO_INCREMENTAL=1

# 使用更少的并行任务（如果 CPU 核心少）
cargo build --bin exomind-rt --release -j 2
```

---

## 架构说明

### 双服务架构

```
┌─────────────────────────────────────────────┐
│  浏览器 (http://192.168.x.x:1420)           │
└─────────────────┬───────────────────────────┘
                  │ HTTP/WebSocket
┌─────────────────▼───────────────────────────┐
│  Vite 开发服务器 (端口 1420)                │
│  - React UI                                 │
│  - TypeScript 实时编译                      │
└─────────────────┬───────────────────────────┘
                  │ HTTP API
┌─────────────────▼───────────────────────────┐
│  exomind-rt Runtime (端口 1949)             │
│  - Agent 运行时                             │
│  - Signal Pool 事件总线                     │
│  - Mesh 网络中继                            │
└─────────────────────────────────────────────┘
```

### 与 Tauri 版的区别

| 特性 | Tauri 版 | Web 版（Termux） |
|------|---------|-----------------|
| 架构 | 单一进程（前后端一体） | 双进程（前后端分离） |
| 启动方式 | `npm run tauri dev` | `npm run dev` + `./exomind-rt` |
| 系统集成 | 原生桌面 API | 受限于浏览器 API |
| 部署复杂度 | 需要交叉编译 | 直接运行 |
| 适用场景 | 桌面应用 | 开发测试、Web 部署 |

---

## 故障排查清单

运行前检查：

- [ ] Node.js 版本 >= 18.x
- [ ] Rust 版本 >= 1.70
- [ ] `node_modules/typescript/lib/` 目录非空
- [ ] `target/release/exomind-rt` 文件存在且可执行
- [ ] 端口 1420 和 1949 未被占用
- [ ] `$TMPDIR` 目录可写

运行时检查：

- [ ] `curl http://127.0.0.1:1420` 返回 200
- [ ] `curl http://127.0.0.1:1949/health` 返回 `{"status":"ok"}`
- [ ] 浏览器控制台无 CORS 错误
- [ ] 后端日志无 panic 或 error

---

## 相关文档

- [ExoMind Runtime Agents API](./exomind-runtime-agents-api.md)
- [端口环境配置](./port-env-configuration.md)
- [架构设计](../architecture/)

---

*最后更新：2026-03-09*
