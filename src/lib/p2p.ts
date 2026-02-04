import { invoke } from '@tauri-apps/api/core';

// Device types matching Rust PairedDevice
export interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  lastSeen?: string;
  ip?: string;
  public_key?: string;
  paired_at?: string;
}

export interface PairingRequest {
  code: string;
  device_name: string;
  device_ip: string;
  public_key: string;
  created_at: string;
}

export interface PairingResult {
  success: boolean;
  device?: Device;
  error?: string;
}

export interface ConnectionResult {
  success: boolean;
  error?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  peerCount: number;
}

/**
 * Get all paired devices
 */
export async function getDevices(): Promise<Device[]> {
  return invoke<Device[]>('get_paired_devices');
}

/**
 * Remove a device from the paired list
 */
export async function removeDevice(id: string): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('remove_paired_device', { device_id: id });
}

/**
 * Generate a new pairing code
 * @param deviceName - Name of this device
 * @param publicKey - Public key for encryption
 */
export async function generatePairingCode(deviceName: string, publicKey: string): Promise<string> {
  // Get local IP
  const ip = await invoke<string>('get_local_ip_with_random_port');
  return invoke<string>('generate_pairing_code', {
    device_name: deviceName,
    device_ip: ip,
    public_key: publicKey,
  });
}

/**
 * Confirm pairing with a code
 */
export async function confirmPairing(code: string, accept: boolean = true): Promise<boolean> {
  return invoke<boolean>('confirm_pairing', { code, accept });
}

/**
 * Get pending pairing requests
 */
export async function getPairingRequests(): Promise<PairingRequest[]> {
  return invoke<PairingRequest[]>('get_pairing_requests');
}

/**
 * Connect to a peer (placeholder - actual implementation depends on libp2p integration)
 */
export async function connectToPeer(peerId: string): Promise<ConnectionResult> {
  // TODO: Implement actual libp2p connection
  return invoke<ConnectionResult>('connect_to_peer', { peerId });
}

/**
 * Disconnect from a peer
 */
export async function disconnectFromPeer(peerId: string): Promise<ConnectionResult> {
  return invoke<ConnectionResult>('disconnect_from_peer', { peerId });
}

/**
 * Get current connection status
 */
export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return invoke<ConnectionStatus>('get_connection_status');
}

/**
 * Get local IP address
 */
export async function getLocalIp(): Promise<string> {
  return invoke<string>('get_local_ip_with_random_port');
}
