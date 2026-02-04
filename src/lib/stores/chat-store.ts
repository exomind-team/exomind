import { create } from 'zustand';
import { DiscoveredDevice } from '../sync/device-discovery';
import { ChatMessage, getMessageStorage } from '../sync/message-storage';
import { invoke } from '@tauri-apps/api/core';

// Re-export for external usage
export type { ChatMessage } from '../sync/message-storage';

// Tauri file system implementation
const tauriFs = {
  writeFile: async (path: string, data: string) => {
    await invoke('write_file', { path, content: data });
  },
  readTextFile: async (path: string) => {
    return await invoke('read_file', { path }) as string;
  },
};

// Message storage singleton
const messageStorage = getMessageStorage(tauriFs);

interface NetworkState {
  isOnline: boolean;
  isSyncing: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  pendingMessages: ChatMessage[];  // 待同步的消息（离线时）
  devices: DiscoveredDevice[];
  pairedDevices: DiscoveredDevice[];
  selectedDevice: DiscoveredDevice | null;
  isConnected: boolean;
  isConnecting: boolean;
  network: NetworkState;
  connectedDeviceCount: number;  // 已连接设备数量

  // Actions
  addMessage: (msg: ChatMessage) => void;
  updateMessageStatus: (id: string, status: ChatMessage['status']) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  addDevice: (device: DiscoveredDevice) => void;
  removeDevice: (id: string) => void;
  selectDevice: (device: DiscoveredDevice | null) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setNetwork: (network: Partial<NetworkState>) => void;
  clearMessages: () => void;

  // Core actions - 本地优先
  sendMessage: (content: string, receiverId?: string) => Promise<void>;
  syncPendingMessages: () => Promise<void>;
  loadMessages: () => Promise<void>;
  loadMessagesWithDevice: (deviceId: string) => Promise<void>;
  markMessageDelivered: (id: string) => Promise<void>;

  // Helpers
  getDeviceId: () => string;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  pendingMessages: [],
  devices: [],
  pairedDevices: [],
  selectedDevice: null,
  isConnected: false,
  isConnecting: false,
  network: {
    isOnline: true,
    isSyncing: false,
  },

  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, msg],
  })),

  updateMessageStatus: (id, status) => set((state) => ({
    messages: state.messages.map((m) =>
      m.id === id ? { ...m, status } : m
    ),
    pendingMessages: state.pendingMessages.map((m) =>
      m.id === id ? { ...m, status } : m
    ),
  })),

  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map((m) =>
      m.id === id ? { ...m, ...updates } : m
    ),
  })),

  addDevice: (device) => set((state) => ({
    devices: [...state.devices, device],
  })),

  removeDevice: (id) => set((state) => ({
    devices: state.devices.filter((d) => d.id !== id),
  })),

  selectDevice: (device) => {
    set({ selectedDevice: device });
    // Load messages with selected device
    if (device) {
      get().loadMessagesWithDevice(device.id);
    }
  },

  setConnected: (connected) => set({ isConnected: connected }),

  setConnecting: (connecting) => set({ isConnecting: connecting }),

  setNetwork: (network) => set((state) => ({
    network: { ...state.network, ...network },
  })),

  clearMessages: () => set({ messages: [], pendingMessages: [] }),

  // ========== 本地优先核心方法 ==========

  /**
   * 发送消息 - 本地优先架构
   * 1. 立即创建消息（乐观更新）
   * 2. 离线时加入待发送队列
   * 3. 在线时尝试发送
   * 4. 监听网络恢复自动同步
   */
  sendMessage: async (content: string, receiverId?: string) => {
    const { network, selectedDevice, addMessage, updateMessageStatus } = get();

    // 确定接收者：优先使用传入的 receiverId，其次是 selectedDevice
    const targetReceiver = receiverId || selectedDevice?.id;

    // 创建消息
    const message = messageStorage.createOutgoingMessage(
      content,
      targetReceiver || 'local'  // 如果没有指定接收者，标记为本地消息
    );

    // 乐观更新：立即添加到本地列表（状态为 sending）
    addMessage(message);

    // 保存到本地存储
    await messageStorage.saveMessage(message);

    // 根据网络状态决定下一步
    if (network.isOnline && targetReceiver) {
      // 在线且有接收者，尝试发送
      try {
        const syncMsg = messageStorage.createSyncMessage(message);
        await invoke('ws_send', { message: JSON.stringify(syncMsg) });
        updateMessageStatus(message.id, 'sent');
      } catch (error) {
        console.error('Failed to send message:', error);
        updateMessageStatus(message.id, 'failed');
        // 发送失败，加入待发送队列
        set((state) => ({
          pendingMessages: [...state.pendingMessages, message],
        }));
      }
    } else {
      // 离线或无接收者，加入待发送队列
      updateMessageStatus(message.id, 'pending');
      set((state) => ({
        pendingMessages: [...state.pendingMessages, message],
      }));
    }

    // 监听网络恢复
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  },

  /**
   * 同步待发送消息
   * 当网络恢复时调用
   */
  syncPendingMessages: async () => {
    const { pendingMessages, network, updateMessageStatus } = get();

    if (pendingMessages.length === 0) return;

    if (!network.isOnline) {
      console.log('Still offline, cannot sync');
      return;
    }

    // 标记正在同步
    set((state) => ({
      network: { ...state.network, isSyncing: true },
    }));

    const stillPending: ChatMessage[] = [];

    for (const msg of pendingMessages) {
      // 检查消息是否有有效的接收者
      if (!msg.receiverId || msg.receiverId === 'local') {
        // 本地消息不需要同步
        updateMessageStatus(msg.id, 'sent');
        continue;
      }

      try {
        const syncMsg = messageStorage.createSyncMessage(msg);
        await invoke('ws_send', { message: JSON.stringify(syncMsg) });
        updateMessageStatus(msg.id, 'sent');
      } catch (error) {
        console.error('Failed to sync message:', msg.id, error);
        stillPending.push(msg);
      }
    }

    // 更新待发送队列
    set((state) => ({
      pendingMessages: stillPending,
      network: { ...state.network, isSyncing: false },
    }));
  },

  /**
   * 标记消息已送达
   */
  markMessageDelivered: async (id: string) => {
    const { updateMessageStatus } = get();
    const message = get().messages.find(m => m.id === id);
    if (message) {
      updateMessageStatus(id, 'delivered');
      // 发送 ACK
      if (message.senderId !== messageStorage.getDeviceId()) {
        const ackMsg: any = {
          type: 'ACK',
          payload: { messageId: id },
          timestamp: Date.now(),
          deviceId: messageStorage.getDeviceId(),
        };
        try {
          await invoke('ws_send', { message: JSON.stringify(ackMsg) });
        } catch (e) {
          console.error('Failed to send ACK:', e);
        }
      }
    }
  },

  loadMessages: async () => {
    try {
      const messages = await messageStorage.getMessages(100);
      set({ messages });
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  },

  loadMessagesWithDevice: async (deviceId: string) => {
    try {
      const messages = await messageStorage.getMessagesWithDevice(deviceId);
      set({ messages });
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  },

  /**
   * 获取本机设备 ID
   */
  getDeviceId: () => {
    return messageStorage.getDeviceId();
  },

  /**
   * 获取已连接设备数量
   */
  connectedDeviceCount: 0,
}));

// 网络状态监听
function handleOnline() {
  console.log('Network online - syncing pending messages');
  useChatStore.getState().setNetwork({ isOnline: true });
  useChatStore.getState().syncPendingMessages();
}

function handleOffline() {
  console.log('Network offline');
  useChatStore.getState().setNetwork({ isOnline: false });
}

// 初始化网络监听
if (typeof window !== 'undefined') {
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // 初始化时检查网络状态
  useChatStore.setState({
    network: { isOnline: navigator.onLine, isSyncing: false }
  });
}

// Initialize message handlers for incoming messages
if (typeof window !== 'undefined') {
  messageStorage.onMessage((message) => {
    useChatStore.getState().addMessage(message);
  });
}
