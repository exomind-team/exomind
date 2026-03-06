import type { AgentConversationChunk, AgentConversationMessage } from '@/lib/types/agent-hub';

type CreateConversationMessageOptions = Pick<
  AgentConversationMessage,
  'source' | 'runtimeEventType' | 'title'
>;

export function createConversationMessage(
  id: string,
  role: AgentConversationMessage['role'],
  content: string,
  options: CreateConversationMessageOptions = {},
): AgentConversationMessage {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...options,
  };
}

export function appendConversationChunk(
  messages: AgentConversationMessage[],
  chunk: AgentConversationChunk,
): AgentConversationMessage[] {
  const index = messages.findIndex((item) => item.id === chunk.messageId);
  if (index === -1) {
    return [
      ...messages,
      createConversationMessage(chunk.messageId, 'agent', chunk.delta),
    ];
  }

  const next = [...messages];
  const current = next[index];
  if (!current) return messages;
  next[index] = {
    ...current,
    content: `${current.content}${chunk.delta}`,
  };
  return next;
}

export function appendConversationDelta(
  messages: AgentConversationMessage[],
  messageId: string,
  delta: string,
  options: CreateConversationMessageOptions = {},
): AgentConversationMessage[] {
  const index = messages.findIndex((item) => item.id === messageId);
  if (index === -1) {
    return [
      ...messages,
      createConversationMessage(messageId, 'agent', delta, options),
    ];
  }

  const next = [...messages];
  const current = next[index];
  if (!current) return messages;
  next[index] = {
    ...current,
    ...options,
    content: `${current.content}${delta}`,
  };
  return next;
}

export function appendAdjacentConversationDelta(
  messages: AgentConversationMessage[],
  newMessageId: string,
  delta: string,
  options: CreateConversationMessageOptions = {},
): AgentConversationMessage[] {
  const current = messages[messages.length - 1];
  if (
    current
    && current.role === 'agent'
    && current.source === options.source
    && current.runtimeEventType === options.runtimeEventType
    && current.title === options.title
  ) {
    const next = [...messages];
    next[next.length - 1] = {
      ...current,
      ...options,
      content: `${current.content}${delta}`,
    };
    return next;
  }

  return [
    ...messages,
    createConversationMessage(newMessageId, 'agent', delta, options),
  ];
}

export function appendConversationMessage(
  messages: AgentConversationMessage[],
  message: AgentConversationMessage,
): AgentConversationMessage[] {
  return [...messages, message];
}

export function formatRuntimeEventPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export function getConversationMessageTestId(message: AgentConversationMessage): string {
  if (message.role === 'user') return 'agent-conversation-message-user';

  switch (message.runtimeEventType) {
    case 'output.delta':
      return 'agent-runtime-event-output';
    case 'thinking.delta':
      return 'agent-runtime-event-thinking';
    case 'tool.call':
      return 'agent-runtime-event-tool-call';
    case 'tool.result':
      return 'agent-runtime-event-tool-result';
    case 'error':
      return 'agent-runtime-event-error';
    default:
      return 'agent-conversation-message-agent-history';
  }
}
