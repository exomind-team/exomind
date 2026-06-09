export type InputMode = 'voice' | 'text';

export type TargetScope =
  | 'unknown'
  | 'event-stream'
  | 'input-box'
  | 'agent-chat'
  | 'external-window';

export interface WindowContext {
  title?: string | null;
  processName?: string | null;
}

export interface AgentInteractionContext {
  agentId?: string | null;
  agentName?: string | null;
  sessionId?: string | null;
}

export interface NormalizedInputEnvelope {
  traceId: string;
  inputMode: InputMode;
  captureSource: string;
  text: string;
  rawText?: string | null;
  lang?: string;
  confidence?: number;
  durationMs?: number;
  targetScope?: TargetScope;
  window?: WindowContext;
  agentContext?: AgentInteractionContext;
}
