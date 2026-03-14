import { create } from 'zustand';
import { log } from '@/lib/logger';

// Simple message type (no sync dependency)
export interface ChatMessage {
  id: string;
  content: string;
  timestamp: number;
  direction: 'outgoing' | 'incoming';
  status: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed';
  senderId?: string;
  receiverId?: string;
}

interface ChatState {
  messages: ChatMessage[];
  pendingMessages: ChatMessage[];

  // Actions
  addMessage: (msg: ChatMessage) => void;
  updateMessageStatus: (id: string, status: ChatMessage['status']) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;

  // Core actions - 本地优先
  sendMessage: (content: string) => Promise<void>;
  loadMessages: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  pendingMessages: [],

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

  clearMessages: () => set({ messages: [], pendingMessages: [] }),

  /**
   * 发送消息 - 本地模式
   */
  sendMessage: async (content: string) => {
    log.info(`[ChatStore] sendMessage called: ${content}`);
    const { addMessage } = get();

    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      content,
      timestamp: Date.now(),
      direction: 'outgoing',
      status: 'sent',
    };

    log.info(`[ChatStore] Adding message: ${JSON.stringify(message)}`);
    addMessage(message);
    log.info(`[ChatStore] Message added, current messages count: ${get().messages.length}`);
  },

  loadMessages: async () => {
    // TODO: 实现本地存储加载
    set({ messages: [] });
  },
}));
