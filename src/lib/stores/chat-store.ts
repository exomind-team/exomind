import { create } from 'zustand';
import { DiscoveredDevice } from '../sync/device-discovery';
import { ChatMessage, getMessageStorage } from '../sync/message-storage';
import { invoke } from '@tauri-apps/api/core';

export type { ChatMessage };

interface TauriFS {
  writeFile: (path: string, data: string) => Promise<void>;
  readTextFile: (path: string) => Promise<string>;
}

// Tauri file system implementation
const tauriFs: TauriFS = {
  writeFile: async (path, data) => {
    await invoke('write_file', { path, content: data });
  },
  readTextFile: async (path) => {
    return await invoke('read_file', { path }) as string;
  },
};

// Message storage singleton
const messageStorage = getMessageStorage(tauriFs);

interface ChatState {
  messages: ChatMessage[];
  devices: DiscoveredDevice[];
  pairedDevices: DiscoveredDevice[];
  selectedDevice: DiscoveredDevice | null;
  isConnected: boolean;
  isConnecting: boolean;

  // Actions
  addMessage: (msg: ChatMessage) => void;
  updateMessageStatus: (id: string, status: ChatMessage['status']) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  addDevice: (device: DiscoveredDevice) => void;
  removeDevice: (id: string) => void;
  selectDevice: (device: DiscoveredDevice | null) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  clearMessages: () => void;

  // Message flow actions
  sendMessage: (content: string) => Promise<void>;
  loadMessages: () => Promise<void>;
  loadMessagesWithDevice: (deviceId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  devices: [],
  pairedDevices: [],
  selectedDevice: null,
  isConnected: false,
  isConnecting: false,

  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, msg],
  })),

  updateMessageStatus: (id, status) => set((state) => ({
    messages: state.messages.map((m) =>
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

  clearMessages: () => set({ messages: [] }),

  sendMessage: async (content: string) => {
    const { selectedDevice, addMessage, updateMessageStatus } = get();

    if (!selectedDevice) {
      throw new Error('No device selected');
    }

    // Create outgoing message
    const message = messageStorage.createOutgoingMessage(
      content,
      selectedDevice.id
    );

    // Add to store (sending state)
    addMessage(message);

    // Save to local storage
    await messageStorage.saveMessage(message);

    try {
      // Send via WebSocket
      const syncMsg = messageStorage.createSyncMessage(message);
      await invoke('ws_send', { message: JSON.stringify(syncMsg) });

      // Update status to sent
      updateMessageStatus(message.id, 'sent');
    } catch (error) {
      console.error('Failed to send message:', error);
      updateMessageStatus(message.id, 'failed');
      throw error;
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
}));

// Initialize message handlers for incoming messages
if (typeof window !== 'undefined') {
  messageStorage.onMessage((message) => {
    useChatStore.getState().addMessage(message);
  });
}
