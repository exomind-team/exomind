# ADR-003: 统一使用 Tauri IPC + Rust 后端架构

## 状态
已接受

## 背景
存在架构冲突：
- 规格定义：Bun HTTP Server (端口1949) → SignalPool
- 实际实现：Tauri IPC → Rust 后端

## 决策
统一使用 **Tauri IPC + Rust 后端** 架构

## 理由
1. 移动端已使用 Tauri Mobile，可直接调用 Rust 后端
2. 桌面端已有 Rust WebSocket 服务端实现
3. 统一技术栈，降低维护复杂度
4. 避免多进程管理复杂性

## 对比分析
| 维度 | Tauri IPC + Rust | Bun HTTP Server |
|------|------------------|-----------------|
| 移动端支持 | ✅ Tauri Mobile 原生支持 | ❌ 需额外实现客户端 |
| 桌面端改动 | 小（已有 Rust 后端） | 大（需重写服务端） |
| 性能 | 高（原生） | 中等 |
| 复杂度 | 低（统一技术栈） | 高（多进程管理） |

## 影响
- 放弃 Bun HTTP Server 方案
- 移动端通过 Tauri 调用 Rust WebSocket 客户端
- 需要更新相关规格文档

## 替代方案
Bun HTTP Server - 因移动端集成复杂度高而拒绝

## 日期
2026-02-04
