import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentConversationMessage } from '@/lib/types/agent-hub';

function createMessage(id: string, role: 'agent' | 'user', content: string): AgentConversationMessage {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function AgentConversationPage({ agentId }: { agentId?: string }) {
  const [messages, setMessages] = useState<AgentConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const targetId = agentId ?? '';

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!targetId) return;
      const history = await getAgentHubService().getConversation(targetId);
      if (!disposed) {
        setMessages(history);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [targetId]);

  const handleSend = async () => {
    const prompt = inputValue.trim();
    if (!prompt || !targetId || sending) return;

    setSending(true);
    setInputValue('');

    const userMessage = createMessage(`msg-user-${crypto.randomUUID()}`, 'user', prompt);
    const pendingMessageId = `msg-agent-pending-${crypto.randomUUID()}`;
    const streamMessage = createMessage(pendingMessageId, 'agent', '');
    setMessages((prev) => [...prev, userMessage, streamMessage]);

    for await (const chunk of getAgentHubService().streamConversation({ agentId: targetId, prompt })) {
      setMessages((prev) => {
        const chunkMessageIndex = prev.findIndex((item) => item.id === chunk.messageId);
        if (chunkMessageIndex >= 0) {
          const next = [...prev];
          next[chunkMessageIndex] = {
            ...next[chunkMessageIndex],
            content: `${next[chunkMessageIndex].content}${chunk.delta}`,
          };
          return next;
        }

        const pendingIndex = prev.findIndex((item) => item.id === pendingMessageId);
        if (pendingIndex >= 0) {
          const next = [...prev];
          next[pendingIndex] = {
            ...next[pendingIndex],
            id: chunk.messageId,
            content: `${next[pendingIndex].content}${chunk.delta}`,
          };
          return next;
        }

        return [...prev, createMessage(chunk.messageId, 'agent', chunk.delta)];
      });
    }
    setSending(false);
  };

  return (
    <div data-testid="agent-conversation-page" className="min-h-full bg-[#FAF7F5]">
      <header className="px-5 py-3">
        <h1 className="text-[17px] font-bold text-[#1C1917]">Agent 对话</h1>
      </header>

      <div className="space-y-3 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">
        {messages.map((message) => {
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  isUser
                    ? 'rounded-tr-[4px] bg-[#C75B3A] text-white'
                    : 'rounded-tl-[4px] border border-[#E7E5E4] bg-white text-[#1C1917]'
                }`}
              >
                {message.content}
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+64px)] left-0 right-0 mx-auto flex w-full max-w-[393px] items-center gap-2 px-4">
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="输入消息..."
          className="h-10 flex-1 rounded-full border border-[#E7E5E4] bg-white px-4 text-sm text-[#1C1917] outline-none"
        />
        <button
          type="button"
          data-testid="agent-chat-send-button"
          disabled={sending}
          onClick={() => {
            void handleSend();
          }}
          className="h-10 rounded-full bg-[#C75B3A] px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          发送
        </button>
      </div>
    </div>
  );
}
