import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// 配对请求接口
export interface PairingRequest {
  code: string;
  device_name: string;
  device_ip: string;
  public_key: string;
}

// 已配对设备接口
export interface PairedDevice {
  id: string;
  name: string;
  ip: string;
  public_key: string;
  paired_at: string;
}

export function usePairing() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 生成配对码
  const generatePairingCode = useCallback(async (
    deviceName: string,
    deviceIP: string,
    publicKey: string
  ): Promise<string | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const code = await invoke<string>('generate_pairing_code', {
        device_name: deviceName,
        device_ip: deviceIP,
        public_key: publicKey,
      });
      return code;
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成配对码失败');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 确认配对
  const confirmPairing = useCallback(async (
    code: string,
    accept: boolean
  ): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<boolean>('confirm_pairing', { code, accept });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认配对失败');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 获取待确认的配对请求
  const getPairingRequests = useCallback(async (): Promise<PairingRequest[]> => {
    try {
      return await invoke<PairingRequest[]>('get_pairing_requests');
    } catch (err) {
      console.error('获取配对请求失败:', err);
      return [];
    }
  }, []);

  // 获取已配对设备
  const getPairedDevices = useCallback(async (): Promise<PairedDevice[]> => {
    try {
      return await invoke<PairedDevice[]>('get_paired_devices');
    } catch (err) {
      console.error('获取已配对设备失败:', err);
      return [];
    }
  }, []);

  // 移除已配对设备
  const removePairedDevice = useCallback(async (
    deviceId: string
  ): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke('remove_paired_device', { deviceId });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除设备失败');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 清除所有待确认的配对请求
  const clearPairingRequests = useCallback(async (): Promise<void> => {
    try {
      await invoke('clear_pairing_requests');
    } catch (err) {
      console.error('清除配对请求失败:', err);
    }
  }, []);

  return {
    isLoading,
    error,
    generatePairingCode,
    confirmPairing,
    getPairingRequests,
    getPairedDevices,
    removePairedDevice,
    clearPairingRequests,
  };
}
