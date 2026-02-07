/**
 * P2P 模块
 * 现代化 P2P 连接状态管理，准备 libp2p 集成架构
 *
 * @module p2p
 */

// 导出类型定义
export * from './types';

// 导出管理器
export { P2PManager, getP2PManager, destroyP2PManager } from './manager';

// 重新导出便捷函数（保持向后兼容）
import {
  getP2PManager,
  type ConnectionResult,
  type ConnectionStatus,
} from './manager';
import type { Device, PairingRequest, PairingResult } from './types';
import { invoke } from '@tauri-apps/api/core';

/**
 * 设备信息（向后兼容类型）
 */
export interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  lastSeen?: string;
  ip?: string;
  public_key?: string;
  paired_at?: string;
}

/**
 * 配对请求（向后兼容类型）
 */
export interface PairingRequest {
  code: string;
  device_name: string;
  device_ip: string;
  public_key: string;
  created_at: string;
}

/**
 * 配对结果（向后兼容类型）
 */
export interface PairingResult {
  success: boolean;
  device?: Device;
  error?: string;
}

/**
 * 连接结果（向后兼容类型）
 */
export interface ConnectionResult {
  success: boolean;
  error?: string;
}

/**
 * 连接状态（向后兼容类型）
 */
export interface ConnectionStatus {
  connected: boolean;
  peerCount: number;
}

// ============================================================================
// 便捷函数（使用 P2PManager 实例）
// ============================================================================

/**
 * 获取所有已配对设备
 */
export async function getDevices(): Promise<Device[]> {
  return getP2PManager().getDevices() as Promise<Device[]>;
}

/**
 * 移除已配对设备
 */
export async function removeDevice(id: string): Promise<{ success: boolean }> {
  return getP2PManager().removeDevice(id);
}

/**
 * 生成配对码
 */
export async function generatePairingCode(
  deviceName: string,
  publicKey: string
): Promise<string> {
  return getP2PManager().generatePairingCode(deviceName, publicKey);
}

/**
 * 确认配对
 */
export async function confirmPairing(
  code: string,
  accept: boolean = true
): Promise<boolean> {
  return getP2PManager().confirmPairing(code, accept);
}

/**
 * 获取待处理的配对请求
 */
export async function getPairingRequests(): Promise<PairingRequest[]> {
  return getP2PManager().getPairingRequests() as Promise<PairingRequest[]>;
}

/**
 * 连接到 peer
 */
export async function connectToPeer(peerId: string): Promise<ConnectionResult> {
  return getP2PManager().connect(peerId);
}

/**
 * 断开与 peer 的连接
 */
export async function disconnectFromPeer(
  peerId: string
): Promise<ConnectionResult> {
  return getP2PManager().disconnect(peerId);
}

/**
 * 获取当前连接状态
 */
export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const status = await getP2PManager().getStatus();
  return {
    connected: status.isConnected,
    peerCount: status.peerCount,
  };
}

/**
 * 断开所有连接
 */
export async function disconnectAll(): Promise<void> {
  return getP2PManager().disconnectAll();
}

/**
 * 获取本地 IP 地址
 */
export async function getLocalIp(): Promise<string> {
  return getP2PManager().getLocalIp();
}

// ============================================================================
// 事件订阅便捷函数
// ============================================================================

import type {
  P2PConnectionState,
  PeerInfo,
  P2PEventType,
  P2PEventPayload,
} from './types';

/**
 * 订阅连接状态变更事件
 */
export function onStateChanged(
  callback: (payload: P2PEventPayload[P2PEventType.StateChanged]) => void
): () => void {
  return getP2PManager().onStateChanged(callback);
}

/**
 * 订阅 peer 连接事件
 */
export function onPeerConnected(
  callback: (payload: P2PEventPayload[P2PEventType.PeerConnected]) => void
): () => void {
  return getP2PManager().onPeerConnected(callback);
}

/**
 * 订阅 peer 断开事件
 */
export function onPeerDisconnected(
  callback: (payload: P2PEventPayload[P2PEventType.PeerDisconnected]) => void
): () => void {
  return getP2PManager().onPeerDisconnected(callback);
}

/**
 * 订阅错误事件
 */
export function onError(
  callback: (payload: P2PEventPayload[P2PEventType.Error]) => void
): () => void {
  return getP2PManager().onError(callback);
}

// ============================================================================
// 直接调用 Tauri 命令（绕过 Manager）
// ============================================================================

/**
 * 直接调用 Tauri 命令 - 获取配对设备
 */
export async function invokeGetDevices(): Promise<Device[]> {
  return invoke<Device[]>('get_paired_devices');
}

/**
 * 直接调用 Tauri 命令 - 移除配对设备
 */
export async function invokeRemoveDevice(id: string): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('remove_paired_device', { device_id: id });
}

/**
 * 直接调用 Tauri 命令 - 获取连接状态
 */
export async function invokeGetConnectionStatus(): Promise<{
  connected: boolean;
  peerCount: number;
  peers: Array<{
    peer_id: string;
    ip: string;
    status: string;
  }>;
}> {
  return invoke('get_connection_status');
}
