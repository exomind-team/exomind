import { ArrowLeft, Bot, Heart, MoreHorizontal, SendHorizontal, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import type { AgentConversationMessage } from '@/lib/types/agent-hub';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { createUuidV4 } from '@/lib/utils/uuid';
import { RuntimeClient } from '@/services/runtime-client';
import { findPreferredRuntimeHostForAgent, getRuntimeManager } from '@/services/runtime-manager';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { formatHostForUrl } from '@/config/runtime-target';
import { getActiveInteractionContextService } from '@/lib/services/active-interaction-context.service';
import {
  readRememberedRuntimeSession,
  rememberRuntimeSession,
} from './runtime-session-cache';
import {
  appendConversationChunk,
  appendAdjacentConversationDelta,
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
  const [chatError, setChatError] = useState('');
  const [runtimeSessionId, setRuntimeSessionId] = useState<string | null>(null);
  const targetId = agentId ?? '';
  const isMobileFullscreenChatRoute = !isDesktop
    && typeof window !== 'undefined'
    && window.location.pathname.startsWith('/agents/chat/');
  const mobileContentPaddingClass = isMobileFullscreenChatRoute
    ? 'pb-[calc(env(safe-area-inset-bottom,0px)+84px)]'
    : 'pb-[calc(env(safe-area-inset-bottom,0px)+108px)]';

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!targetId) return;
      try {
        const snapshot = await getRuntimeManager().refreshSnapshot();
        const runtimeHost = findPreferredRuntimeHostForAgent(snapshot.hosts, targetId);
        if (runtimeHost) {
          if (!disposed) {
            setMessages([]);
            setChatError('');
            setRuntimeSessionId(readRememberedRuntimeSession({
              agentId: targetId,
              hostId: runtimeHost.id,
              hostAddress: `${runtimeHost.host}:${runtimeHost.port}`,
            }));
          }
          return;
        }

        const history = await getAgentHubService().getConversation(targetId);
        if (!disposed) {
          setMessages(history);
          setChatError('');
          setRuntimeSessionId(null);
        }
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error);
          setMessages([]);
          setChatError(`加载会话失败: ${message}`);
          setRuntimeSessionId(null);
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [targetId]);

  useEffect(() => {
    const service = getActiveInteractionContextService();
    const ownerId = 'agent-conversation-page';

    if (!targetId) {
      service.clearContext(ownerId);
      return () => {
        service.clearContext(ownerId);
      };
    }

    service.setContext({
      targetScope: 'agent-chat',
      agentContext: {
        agentId: targetId,
        sessionId: runtimeSessionId ?? undefined,
      },
    }, ownerId);

    return () => {
      service.clearContext(ownerId);
    };
  }, [targetId, runtimeSessionId]);

  // Subscribe to SSE signal stream for tick/heartbeat signals
  const sseRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!targetId) return;
    let disposed = false;

    const connect = async () => {
      try {
        const hosts = await getRuntimeHostService().listHosts();
        if (hosts.length === 0 || disposed) return;
        const host = hosts[0];
        const url = `http://${formatHostForUrl(host.host)}:${host.port}/signals/stream?agent_id=${encodeURIComponent(targetId)}&heartbeat_interval=30`;
        const es = new EventSource(url);
        sseRef.current = es;

        es.addEventListener('signal', (event) => {
          if (disposed) return;
          try {
            const signal = JSON.parse(event.data);
            const topic: string = signal.topic ?? '';
            const payload = signal.payload ?? {};
            const signalAgentId: string = payload.agent_id ?? '';

            // Only show signals relevant to this agent
            if (signalAgentId && signalAgentId !== targetId) return;

            if (topic === 'heartbeat.pulse') {
              const message = payload.message ?? '💓 心跳';
              setMessages((prev) => appendConversationMessage(prev, createConversationMessage(
                `msg-tick-${signal.id ?? createUuidV4()}`,
                'agent',
                message,
                { title: '自主心跳' },
              )));
            } else if (topic === 'agent.tick') {
              const energy = payload.energy ?? {};
              const phase = payload.phase ?? '';
              const tickCount = payload.tick_count ?? 0;
              const interval = payload.tick_interval_secs ?? 0;
              setMessages((prev) => appendConversationMessage(prev, createConversationMessage(
                `msg-tick-meta-${signal.id ?? createUuidV4()}`,
                'agent',
                `Tick #${tickCount} · 能量 ${energy.current ?? '?'}/${energy.max ?? '?'} · ${phase} · 下次 ${interval}s`,
                { source: 'runtime', runtimeEventType: 'output.delta', title: '⏱ Tick 元信号' },
              )));
            } else if (topic === 'agent.dormant') {
              setMessages((prev) => appendConversationMessage(prev, createConversationMessage(
                `msg-dormant-${signal.id ?? createUuidV4()}`,
                'agent',
                '🩶 能量耗尽，进入休眠。生命过程暂停。',
                { title: '休眠' },
              )));
            }
          } catch {
            // ignore malformed SSE data
          }
        });

        es.onerror = () => {
          // SSE will auto-reconnect
        };
      } catch {
        // ignore connection errors
      }
    };

    void connect();
    return () => {
      disposed = true;
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, [targetId]);

  const handleSend = async () => {
    const prompt = inputValue.trim();
    if (!prompt || !targetId || sending) return;

    setSending(true);
    setInputValue('');
    setChatError('');

    const userMessage = createConversationMessage(`msg-user-${createUuidV4()}`, 'user', prompt);
    setMessages((prev) => [...prev, userMessage]);

    try {
      const snapshot = await getRuntimeManager().refreshSnapshot();
      const runtimeHost = findPreferredRuntimeHostForAgent(snapshot.hosts, targetId);
      let receivedRenderableEvent = false;

      if (runtimeHost) {
        const hostAddress = `${runtimeHost.host}:${runtimeHost.port}`;
        const runtimeClient = new RuntimeClient();
        for await (const chunk of runtimeClient.streamAgentConversation(runtimeHost, {
          agentId: targetId,
          message: prompt,
          sessionId: runtimeSessionId ?? undefined,
        })) {
          if (chunk.sessionId) {
            setRuntimeSessionId(chunk.sessionId);
            rememberRuntimeSession({
              agentId: targetId,
              sessionId: chunk.sessionId,
              hostId: runtimeHost.id,
              hostAddress,
            });
          }

          switch (chunk.type) {
            case 'session.started':
              setRuntimeSessionId(chunk.sessionId ?? null);
              if (chunk.sessionId) {
                rememberRuntimeSession({
                  agentId: targetId,
                  sessionId: chunk.sessionId,
                  hostId: runtimeHost.id,
                  hostAddress,
                });
              }
              break;
            case 'output.delta':
              receivedRenderableEvent = true;
              setMessages((prev) => appendAdjacentConversationDelta(
                prev,
                `msg-agent-runtime-output-${createUuidV4()}`,
                chunk.content,
                {
                  source: 'runtime',
                  runtimeEventType: 'output.delta',
                },
              ));
              break;
            case 'thinking.delta':
              receivedRenderableEvent = true;
              setMessages((prev) => appendAdjacentConversationDelta(
                prev,
                `msg-agent-runtime-thinking-${createUuidV4()}`,
                chunk.content,
                {
                  source: 'runtime',
                  runtimeEventType: 'thinking.delta',
                  title: 'Thinking',
                },
              ));
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
              setMessages((prev) => appendAdjacentConversationDelta(
                prev,
                `msg-agent-runtime-error-${createUuidV4()}`,
                chunk.message ?? chunk.content,
                {
                  source: 'runtime',
                  runtimeEventType: 'error',
                  title: 'Runtime Error',
                },
              ));
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
      if (!receivedRenderableEvent) {
        setChatError('Agent 未返回可显示内容');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatError(`发送失败: ${message}`);
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

      <div className={`min-h-0 flex-1 overflow-y-auto space-y-3 px-4 pt-3 md:px-8 lg:px-10 ${isDesktop ? 'pb-4' : mobileContentPaddingClass}`}>
        {messages.map((message) => {
          const isUser = message.role === 'user';
          const isTickSignal = message.id.startsWith('msg-tick-') || message.id.startsWith('msg-dormant-');
          const isRuntimeMeta = !isTickSignal && !!message.runtimeEventType && message.runtimeEventType !== 'output.delta';
          const testId = getConversationMessageTestId(message);
          return (
            <div key={message.id} className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  isTickSignal ? 'bg-[#EF444420] text-[#EF4444]' : 'bg-[#C75B3A] text-white'
                }`}>
                  {isTickSignal ? <Heart size={12} /> : <Bot size={12} />}
                </div>
              )}
              <div
                data-testid={testId}
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  isUser
                    ? 'rounded-tr-[6px] bg-[#C75B3A] text-white'
                    : isTickSignal
                      ? 'rounded-tl-[6px] border border-[#EF444430] bg-[#EF444408] text-foreground'
                      : isRuntimeMeta
                        ? 'rounded-tl-[6px] border border-border-card bg-muted text-muted-foreground'
                        : 'rounded-tl-[6px] border border-border-card bg-card text-strong'
                }`}
              >
                {message.title && (
                  <p className={`mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
                    isTickSignal ? 'text-[#EF4444]' : 'text-muted-foreground'
                  }`}>
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

      {chatError && (
        <div className="border-t border-border-card px-4 py-2 text-xs text-destructive md:px-8 lg:px-10">
          {chatError}
        </div>
      )}

      <div
        data-testid="agent-chat-input-bar"
        className={isDesktop
          ? 'flex items-center gap-2 border-t border-border-card bg-surface px-4 py-3 md:px-8 lg:px-10'
          : isMobileFullscreenChatRoute
            ? 'fixed bottom-[env(safe-area-inset-bottom,0px)] left-0 right-0 mx-auto flex w-full max-w-[393px] items-center gap-2 border-t border-border-card bg-surface px-4 py-3'
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
