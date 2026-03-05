import { ArrowLeft, Bot, MoreHorizontal, SendHorizontal, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentConversationMessage } from '@/lib/types/agent-hub';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { createUuidV4 } from '@/lib/utils/uuid';

function createMessage(id: string, role: 'agent' | 'user', content: string): AgentConversationMessage {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function AgentConversationPage({ agentId }: { agentId?: string }) {
  const isDesktop = useIsDesktop();
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

    const userMessage = createMessage(`msg-user-${createUuidV4()}`, 'user', prompt);
    const pendingMessageId = `msg-agent-pending-${createUuidV4()}`;
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
    <div data-testid="agent-conversation-page" className="flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]">
      <header data-testid="agent-conversation-header" className="flex items-center justify-between border-b border-[#F0ECE8] px-4 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
          aria-label="返回（Back）"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-[17px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">日报 Agent</h1>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
          aria-label="更多（More）"
        >
          <MoreHorizontal size={16} />
        </button>
      </header>

      <div className={`min-h-0 flex-1 overflow-y-auto space-y-3 px-4 pt-3 md:px-8 lg:px-10 ${isDesktop ? 'pb-4' : 'pb-[calc(env(safe-area-inset-bottom,0px)+108px)]'}`}>
        {messages.map((message) => {
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C75B3A] text-white">
                  <Bot size={12} />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  isUser
                    ? 'rounded-tr-[6px] bg-[#C75B3A] text-white'
                    : 'rounded-tl-[6px] border border-[#E7E5E4] bg-white text-[#1C1917] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9]'
                }`}
              >
                {message.content}
              </div>
              {isUser && (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                  <UserRound size={12} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        data-testid="agent-chat-input-bar"
        className={isDesktop
          ? 'flex items-center gap-2 border-t border-[#E7E5E4] bg-[#FAF7F5] px-4 py-3 dark:border-[#292524] dark:bg-[#0C0A09] md:px-8 lg:px-10'
          : 'fixed bottom-[calc(env(safe-area-inset-bottom,0px)+64px)] left-0 right-0 mx-auto flex w-full max-w-[393px] items-center gap-2 border-t border-[#E7E5E4] bg-[#FAF7F5] px-4 py-3 dark:border-[#292524] dark:bg-[#0C0A09]'
        }
      >
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="输入消息..."
          className="h-9 flex-1 rounded-full border border-[#E7E5E4] bg-white px-4 text-sm text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
        />
        <button
          type="button"
          data-testid="agent-chat-send-button"
          disabled={sending}
          onClick={() => {
            void handleSend();
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C75B3A] text-white disabled:opacity-60"
          aria-label="发送（Send）"
        >
          <SendHorizontal size={15} />
        </button>
      </div>
    </div>
  );
}
