/**
 * Runtime topology response（运行时拓扑响应）
 * Mirrors Rust `TopologyResponse` contract（与 Rust `TopologyResponse` 结构体对齐）
 */
export interface RuntimeTopologyResponse {
  hostname: string; // 主机名
  os: string; // 操作系统
  arch: string; // CPU 架构（CPU architecture）
  uptime_secs: number; // 运行时长（秒）
  version: string; // runtime 版本
  port: number; // runtime 监听端口
}
