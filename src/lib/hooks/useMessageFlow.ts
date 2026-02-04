import { useCallback } from 'react';
import { useChatStore } from '../stores/chat-store';
import { invoke } from '@tauri-apps/api/core';
import type { DiscoveredDevice } from '../sync/device-discovery';

/**
 * Message Flow Hook
 * Handles WebSocket message sending and receiving
 */
export function useMessageFlow() {
  const {
    selectedDevice,
    isConnected,
    setConnected,
    setConnecting,
  } = useChatStore();

  // Connect to WebSocket when device is selected
  const connect = useCallback(async (device: DiscoveredDevice | null) => {
    if (!device || isConnected) return;

    setConnecting(true);
    try {
      await invoke('ws_connect', { url: `ws://${device.ip}:${device.port}` });
      setConnected(true);
    } catch (error) {
      console.error('Failed to connect:', error);
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  }, [isConnected, setConnecting, setConnected]);

  // Disconnect from WebSocket
  const disconnect = useCallback(async () => {
    try {
      await invoke('ws_disconnect');
    } catch (error) {
      console.error('Failed to disconnect:', error);
    } finally {
      setConnected(false);
    }
  }, [setConnected]);

  return {
    selectedDevice,
    isConnected,
    connect,
    disconnect,
  };
}

/**
 * Connection Status Hook
 * Manages connection status display
 */
export function useConnectionStatus() {
  const { isConnected, isConnecting, selectedDevice } = useChatStore();

  const status = selectedDevice
    ? isConnecting
      ? 'connecting'
      : isConnected
        ? 'connected'
        : 'disconnected'
    : 'offline';

  const statusText = {
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '连接断开',
    offline: '离线模式',
  }[status];

  return { status, statusText };
}
