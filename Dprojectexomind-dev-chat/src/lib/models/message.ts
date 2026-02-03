export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'failed';
export type MessageType = 'text' | 'image' | 'file';
export interface Message {
  id: string;
  type: MessageType;
  content: string;
  from: string;
  to: string;
  status: MessageStatus;
  timestamp: string;
}
export interface CreateMessageParams {
  content: string;
  from: string;
  to: string;
  type?: MessageType;
}
export function createMessage(params: CreateMessageParams): Message {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 11);
  return {
    id: 'msg-' + timestamp + '-' + random,
    type: params.type || 'text',
    content: params.content,
    from: params.from,
    to: params.to,
    status: 'sending',
    timestamp: new Date().toISOString(),
  };
}
