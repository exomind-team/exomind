import { create } from 'zustand';
import { DiscoveredDevice } from '../sync/device-discovery';

export interface ChatMessage {
  id: string;
  content: string;
  timestamp: number;
  sender: string;
  status: 'sending' | 'sent' | 'delivered' | 'failed';
}

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
  addDevice: (device: DiscoveredDevice) => void;
  removeDevice: (id: string) => void;
  selectDevice: (device: DiscoveredDevice | null) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
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

  addDevice: (device) => set((state) => ({
    devices: [...state.devices, device],
  })),

  removeDevice: (id) => set((state) => ({
    devices: state.devices.filter((d) => d.id !== id),
  })),

  selectDevice: (device) => set({ selectedDevice: device }),

  setConnected: (connected) => set({ isConnected: connected }),

  setConnecting: (connecting) => set({ isConnecting: connecting }),

  clearMessages: () => set({ messages: [] }),
}));
