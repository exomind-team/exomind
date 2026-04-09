/**
 * Runtime topology response（运行时拓扑响应）
 * Mirrors Rust `TopologyResponse` contract（与 Rust `TopologyResponse` 结构体对齐）
 * while introducing the nested device foundation contract（同时引入嵌套设备基础契约）
 */

export type RuntimeCapabilityAgentKind = 'claude_cli' | 'codex_cli' | 'api';

export type RuntimeCapabilityApiProvider = 'openai' | 'anthropic';

export interface RuntimeTopologyCapabilities {
  agent_kinds: RuntimeCapabilityAgentKind[];
  api_providers: RuntimeCapabilityApiProvider[];
}

export interface RuntimeTopologyRuntimeHost {
  host_id?: string; // 逻辑主机 ID（logical host id）
  hostname: string; // 主机名（hostname）
  os: string; // 操作系统（operating system）
  arch: string; // CPU 架构（CPU architecture）
  uptime_secs: number; // 在线时长（uptime seconds）
  version: string; // runtime 版本（runtime version）
  port: number; // runtime 监听端口（runtime listen port）
  total_memory_mb?: number; // 总内存（MB）
  used_memory_mb?: number; // 已用内存（MB）
  capabilities: RuntimeTopologyCapabilities; // 运行时能力（runtime capabilities）
}

export type RuntimeTopologyDeviceKind =
  | 'desktop'
  | 'laptop'
  | 'phone'
  | 'server'
  | 'embedded'
  | 'wearable'
  | 'unknown';

export interface RuntimeTopologyDevice {
  id: string; // 设备 ID（device id）
  name: string; // 设备名称（device name）
  kind: RuntimeTopologyDeviceKind; // 设备类型（device kind）
  primary_runtime_host_id?: string; // 主宿主 ID（primary runtime host id）
}

export interface RuntimeTopologyDeviceComponent {
  id: string; // 部件 ID（component id）
  device_id: string; // 所属设备 ID（owner device id）
  kind: string; // 部件类型（component kind）
  name: string; // 部件名称（component name）
  status: string; // 部件状态（component status）
  protocol?: string; // 协议（protocol）
  runtime_host_id?: string; // 所属宿主 ID（runtime host id）
}

export interface RuntimeTopologyDeviceLink {
  id: string; // 链路 ID（link id）
  source_kind: string; // 源类型（source kind）
  source_id: string; // 源对象 ID（source id）
  target_kind: string; // 目标类型（target kind）
  target_id: string; // 目标对象 ID（target id）
  transport: string; // 传输方式（transport）
  status: string; // 链路状态（link status）
  latency_ms?: number; // 时延（latency ms）
}

export interface RuntimeTopologyResponse {
  host_id?: string; // legacy host_id（旧 host_id）
  hostname: string; // legacy hostname（旧 hostname）
  os: string; // legacy os（旧 os）
  arch: string; // legacy arch（旧 arch）
  uptime_secs: number; // legacy uptime_secs（旧 uptime_secs）
  version: string; // legacy version（旧 version）
  port: number; // legacy port（旧 port）
  total_memory_mb?: number; // legacy total_memory_mb（旧 total_memory_mb）
  used_memory_mb?: number; // legacy used_memory_mb（旧 used_memory_mb）
  capabilities: RuntimeTopologyCapabilities; // legacy capabilities（旧 capabilities）
  runtime_host?: RuntimeTopologyRuntimeHost; // 规范化宿主对象（normalized runtime host）
  device?: RuntimeTopologyDevice; // 规范化设备对象（normalized device）
  device_components?: RuntimeTopologyDeviceComponent[]; // 设备部件（device components）
  device_links?: RuntimeTopologyDeviceLink[]; // 设备链路（device links）
}

export function resolveTopologyRuntimeHost(
  topology: RuntimeTopologyResponse | null | undefined,
): RuntimeTopologyRuntimeHost | null {
  if (!topology) return null;

  if (topology.runtime_host) {
    return topology.runtime_host;
  }

  return {
    host_id: topology.host_id,
    hostname: topology.hostname,
    os: topology.os,
    arch: topology.arch,
    uptime_secs: topology.uptime_secs,
    version: topology.version,
    port: topology.port,
    total_memory_mb: topology.total_memory_mb,
    used_memory_mb: topology.used_memory_mb,
    capabilities: topology.capabilities,
  };
}

export function resolveTopologyHostId(
  topology: RuntimeTopologyResponse | null | undefined,
): string | undefined {
  return resolveTopologyRuntimeHost(topology)?.host_id ?? topology?.host_id;
}

export function resolveTopologyCapabilities(
  topology: RuntimeTopologyResponse | null | undefined,
): RuntimeTopologyCapabilities | null {
  const runtimeHost = resolveTopologyRuntimeHost(topology);
  if (runtimeHost?.capabilities) {
    return runtimeHost.capabilities;
  }
  return topology?.capabilities ?? null;
}

export function resolveTopologyDevice(
  topology: RuntimeTopologyResponse | null | undefined,
): RuntimeTopologyDevice | null {
  if (!topology) return null;
  if (topology.device) {
    return topology.device;
  }

  const runtimeHost = resolveTopologyRuntimeHost(topology);
  if (!runtimeHost) {
    return null;
  }

  const fallbackId = runtimeHost.host_id ?? runtimeHost.hostname;
  return {
    id: fallbackId,
    name: runtimeHost.hostname,
    kind: 'unknown',
    primary_runtime_host_id: runtimeHost.host_id ?? fallbackId,
  };
}

export function normalizeRuntimeTopologyResponse(
  topology: RuntimeTopologyResponse,
): RuntimeTopologyResponse {
  const runtimeHost = resolveTopologyRuntimeHost(topology);
  const capabilities = resolveTopologyCapabilities(topology);
  const device = resolveTopologyDevice(topology);

  if (!runtimeHost || !capabilities) {
    return topology;
  }

  return {
    ...topology,
    host_id: runtimeHost.host_id ?? topology.host_id,
    hostname: runtimeHost.hostname,
    os: runtimeHost.os,
    arch: runtimeHost.arch,
    uptime_secs: runtimeHost.uptime_secs,
    version: runtimeHost.version,
    port: runtimeHost.port,
    total_memory_mb: runtimeHost.total_memory_mb,
    used_memory_mb: runtimeHost.used_memory_mb,
    capabilities,
    runtime_host: runtimeHost,
    device: device ?? topology.device,
    device_components: topology.device_components ?? [],
    device_links: topology.device_links ?? [],
  };
}
