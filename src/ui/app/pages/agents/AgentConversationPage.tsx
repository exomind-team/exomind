import { ArrowLeft, Bot, MoreHorizontal, SendHorizontal, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentConversationMessage } from '@/lib/types/agent-hub';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { createUuidV4 } from '@/lib/utils/uuid';
import { RuntimeClient } from '@/services/runtime-client';
import { findPreferredRuntimeHostForAgent, getRuntimeManager } from '@/services/runtime-manager';
import {
  appendConversationChunk,
  appendConversationDelta,
  appendConversationMessage,
  createConversationMessage,
  formatRuntimeEventPayload,
  getConversationMessageTestId,
} from './conversation-runtime';

export function AgentConversationPage({ agentId }: { agentId?: string }) {
  const isDesktop = useIsDesktop();
  const [messages, setMessages] = useState<AgentConversationMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [runtimeSessionId, setRuntimeSessionId] = useState<string | null>(null);
  const targetId = agentId ?? '';

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!targetId) return;
      const snapshot = await getRuntimeManager().refreshSnapshot();
      const runtimeHost = findPreferredRuntimeHostForAgent(snapshot.hosts, targetId);
      if (runtimeHost) {
        if (!disposed) {
          setMessages([]);
          setRuntimeSessionId(null);
        }
        return;
      }

      const history = await getAgentHubService().getConversation(targetId);
      if (!disposed) {
        setMessages(history);
        setRuntimeSessionId(null);
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

    const userMessage = createConversationMessage(`msg-user-${createUuidV4()}`, 'user', prompt);
    setMessages((prev) => [...prev, userMessage]);

    try {
      const snapshot = await getRuntimeManager().refreshSnapshot();
      const runtimeHost = findPreferredRuntimeHostForAgent(snapshot.hosts, targetId);
      let receivedRenderableEvent = false;

      if (runtimeHost) {
        const runtimeClient = new RuntimeClient();
        const outputMessageId = `msg-agent-runtime-output-${createUuidV4()}`;
        const thinkingMessageId = `msg-agent-runtime-thinking-${createUuidV4()}`;
        const errorMessageId = `msg-agent-runtime-error-${createUuidV4()}`;

        for await (const chunk of runtimeClient.streamAgentConversation(runtimeHost, {
          agentId: targetId,
          message: prompt,
          sessionId: runtimeSessionId ?? undefined,
        })) {
          if (chunk.sessionId) {
            setRuntimeSessionId(chunk.sessionId);
          }

          switch (chunk.type) {
            case 'session.started':
              setRuntimeSessionId(chunk.sessionId);
              break;
            case 'output.delta':
              receivedRenderableEvent = true;
              setMessages((prev) => appendConversationDelta(prev, outputMessageId, chunk.content, {
                source: 'runtime',
                runtimeEventType: 'output.delta',
              }));
              break;
            case 'thinking.delta':
              receivedRenderableEvent = true;
              setMessages((prev) => appendConversationDelta(prev, thinkingMessageId, chunk.content, {
                source: 'runtime',
                runtimeEventType: 'thinking.delta',
                title: 'Thinking',
              }));
              break;
            case 'tool.call':
              receivedRenderableEvent = true;
              setMessages((prev) => appendConversationMessage(prev, createConversationMessage(
                `msg-agent-tool-call-${createUuidV4()}`,
                'agent',
                formatRuntimeEventPayload(chunk.payload),
                {
                  source: 'runtime',
                  runtimeEventType: 'tool.call',
                  title: `Tool Call · ${chunk.name}`,
                },
              )));
              break;
            case 'tool.result':
              receivedRenderableEvent = true;
              setMessages((prev) => appendConversationMessage(prev, createConversationMessage(
                `msg-agent-tool-result-${createUuidV4()}`,
                'agent',
                formatRuntimeEventPayload(chunk.payload),
                {
                  source: 'runtime',
                  runtimeEventType: 'tool.result',
                  title: `Tool Result · ${chunk.name}`,
                },
              )));
              break;
            case 'error':
              receivedRenderableEvent = true;
              setMessages((prev) => appendConversationDelta(prev, errorMessageId, chunk.message, {
                source: 'runtime',
                runtimeEventType: 'error',
                title: 'Runtime Error',
              }));
              break;
            case 'done':
              break;
          }
        }
      } else {
        const pendingMessageId = `msg-agent-pending-${createUuidV4()}`;
        const streamMessage = createConversationMessage(pendingMessageId, 'agent', '');
        setMessages((prev) => [...prev, streamMessage]);

        for await (const chunk of getAgentHubService().streamConversation({ agentId: targetId, prompt })) {
          if (!chunk.delta) continue;
          receivedRenderableEvent = true;
          setMessages((prev) => {
            const chunkMessageIndex = prev.findIndex((item) => item.id === chunk.messageId);
            if (chunkMessageIndex >= 0) {
              return appendConversationChunk(prev, chunk);
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

            return appendConversationChunk(prev, chunk);
          });
        }

        if (!receivedRenderableEvent) {
          setMessages((prev) => prev.filter((item) => item.id !== pendingMessageId));
        }
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-testid="agent-conversation-page" className="flex h-full min-h-full flex-col bg-surface text-foreground">
      <header data-testid="agent-conversation-header" className="flex items-center justify-between border-b border-border-card px-4 py-3 md:px-8 lg:px-10">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-label="返回（Back）"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-[17px] font-bold text-foreground">日报 Agent</h1>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
          aria-label="更多（More）"
        >
          <MoreHorizontal size={16} />
        </button>
      </header>

      <div className={`min-h-0 flex-1 overflow-y-auto space-y-3 px-4 pt-3 md:px-8 lg:px-10 ${isDesktop ? 'pb-4' : 'pb-[calc(env(safe-area-inset-bottom,0px)+108px)]'}`}>
        {messages.map((message) => {
          const isUser = message.role === 'user';
          const isRuntimeMeta = !!message.runtimeEventType && message.runtimeEventType !== 'output.delta';
          const testId = getConversationMessageTestId(message);

          return (
            <div key={message.id} className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C75B3A] text-white">
                  <Bot size={12} />
                </div>
              )}
              <div
                data-testid={testId}
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  isUser
                    ? 'rounded-tr-[6px] bg-[#C75B3A] text-white'
                    : isRuntimeMeta
                      ? 'rounded-tl-[6px] border border-border-card bg-muted text-muted-foreground'
                      : 'rounded-tl-[6px] border border-border-card bg-card text-strong'
                }`}
              >
                {message.title && (
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {message.title}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
              {isUser && (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
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
          ? 'flex items-center gap-2 border-t border-border-card bg-surface px-4 py-3 md:px-8 lg:px-10'
          : 'fixed bottom-[calc(env(safe-area-inset-bottom,0px)+64px)] left-0 right-0 mx-auto flex w-full max-w-[393px] items-center gap-2 border-t border-border-card bg-surface px-4 py-3'
        }
      >
        <input
          data-testid="agent-chat-input"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="输入消息..."
          className="h-9 flex-1 rounded-full border border-border-card bg-card px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground"
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
