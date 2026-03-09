/**
 * Runtime topology response（运行时拓扑响应）
 * Mirrors Rust `TopologyResponse` contract（与 Rust `TopologyResponse` 结构体对齐）
 */
export type RuntimeCapabilityAgentKind = 'claude_cli' | 'codex_cli' | 'api';

export type RuntimeCapabilityApiProvider = 'openai' | 'anthropic';

export interface RuntimeTopologyCapabilities {
  agent_kinds: RuntimeCapabilityAgentKind[];
  api_providers: RuntimeCapabilityApiProvider[];
}

export interface RuntimeTopologyResponse {
  host_id?: string; // 逻辑主机 ID（logical host id）
  hostname: string; // 主机名
  os: string; // 操作系统
  arch: string; // CPU 架构（CPU architecture）
  uptime_secs: number; // 保持 snake_case 与 Rust JSON 契约一致（wire format alignment）
  version: string; // runtime 版本
  port: number; // runtime 监听端口
  total_memory_mb?: number; // 总内存（MB）
  used_memory_mb?: number; // 已用内存（MB）
  capabilities: RuntimeTopologyCapabilities; // Runtime 能力（capabilities，能力）
}
