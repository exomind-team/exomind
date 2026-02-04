import { useCallback } from 'react';
import { useChatStore } from '../stores/chat-store';
import { invoke } from '@tauri-apps/api/core';
import type { DiscoveredDevice } from '../sync/device-discovery';

/**
 * Message Flow Hook
 * Handles WebSocket message sending and receiving
 * 适配本地优先架构
 */
export function useMessageFlow() {
  const {
    selectedDevice,
    isConnected,
    isConnecting,
    setConnected,
    setConnecting,
    network,
  } = useChatStore();

  // Connect to WebSocket when device is selected
  const connect = useCallback(async (device: DiscoveredDevice | null) => {
    if (!device || isConnected) return;

    setConnecting(true);
    try {
      const result = await invoke('ws_connect', { url: `ws://${device.ip}:${device.port}` });
      console.log('WebSocket connected:', result);
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

  // Auto-connect when device is selected
  const autoConnect = useCallback(() => {
    if (selectedDevice && !isConnected && !isConnecting) {
      connect(selectedDevice);
    }
  }, [selectedDevice, isConnected, isConnecting, connect]);

  return {
    selectedDevice,
    isConnected,
    isConnecting,
    network,
    connect,
    disconnect,
    autoConnect,
  };
}

/**
 * Connection Status Hook
 * Manages connection status display
 */
export function useConnectionStatus() {
  const { isConnected, isConnecting, selectedDevice, network } = useChatStore();

  const status = network.isOnline
    ? (selectedDevice
        ? (isConnecting
            ? 'connecting'
            : isConnected
              ? 'connected'
              : 'disconnected')
        : 'offline')
    : 'offline';

  const statusText = {
    connected: '已连接',
    connecting: '连接中...',
    disconnected: '连接断开',
    offline: '离线模式',
  }[status];

  return { status, statusText };
}

/**
 * Send Message Hook
 * 适配本地优先架构 - 无需连接也可发送
 */
export function useSendMessage() {
  const { sendMessage, syncPendingMessages, network, pendingMessages } = useChatStore();

  const send = useCallback(async (content: string, receiverId?: string) => {
    await sendMessage(content, receiverId);
  }, [sendMessage]);

  const sync = useCallback(async () => {
    if (network.isOnline && pendingMessages.length > 0) {
      await syncPendingMessages();
    }
  }, [network.isOnline, pendingMessages.length, syncPendingMessages]);

  return { send, sync, pendingCount: pendingMessages.length };
}
