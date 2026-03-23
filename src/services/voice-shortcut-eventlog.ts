import { sha256 } from '@/adapters/crypto-adapter';
import { getEventSourceMetadata } from '@/lib/eventlog/source-metadata';
import type { AgentInteractionContext, TargetScope, WindowContext } from '@/lib/types/normalized-input';
import type { Event } from '@/lib/storage/event-storage';

const VOICE_SHORTCUT_ACTIVATION_BUCKET_MS = 500;

type VoiceShortcutMetadata = {
  dedupVersion: 'v1';
  captureSource: 'global-shortcut';
  activationBucketMs: number;
  targetScope: TargetScope;
  text: string;
  window?: {
    title?: string;
    processName?: string;
  };
  agentContext?: {
    agentId?: string;
    agentName?: string;
    sessionId?: string;
  };
};

export interface BuildVoiceShortcutStorageEventInput {
  text: string;
  startedAtMs: number;
  targetScope: TargetScope;
  window?: WindowContext;
  agentContext?: AgentInteractionContext;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeWindow(window?: WindowContext): VoiceShortcutMetadata['window'] | undefined {
  if (!window) {
    return undefined;
  }

  const normalized = {
    title: normalizeOptionalString(window.title),
    processName: normalizeOptionalString(window.processName),
  };

  return normalized.title || normalized.processName ? normalized : undefined;
}

function normalizeAgentContext(agentContext?: AgentInteractionContext): VoiceShortcutMetadata['agentContext'] | undefined {
  if (!agentContext) {
    return undefined;
  }

  const normalized = {
    agentId: normalizeOptionalString(agentContext.agentId),
    agentName: normalizeOptionalString(agentContext.agentName),
    sessionId: normalizeOptionalString(agentContext.sessionId),
  };

  return normalized.agentId || normalized.agentName || normalized.sessionId ? normalized : undefined;
}

function toActivationBucketMs(startedAtMs: number): number {
  return Math.floor(startedAtMs / VOICE_SHORTCUT_ACTIVATION_BUCKET_MS) * VOICE_SHORTCUT_ACTIVATION_BUCKET_MS;
}

export async function buildVoiceShortcutStorageEvent(
  input: BuildVoiceShortcutStorageEventInput,
): Promise<Event> {
  const text = input.text.trim();
  if (!text) {
    throw new Error('voice shortcut event requires non-empty text（语音快捷键事件不能为空）');
  }

  const activationBucketMs = toActivationBucketMs(input.startedAtMs);
  const normalizedWindow = normalizeWindow(input.window);
  const normalizedAgentContext = normalizeAgentContext(input.agentContext);
  const metadata: VoiceShortcutMetadata = {
    dedupVersion: 'v1',
    captureSource: 'global-shortcut',
    activationBucketMs,
    targetScope: input.targetScope,
    text,
    ...(normalizedWindow ? { window: normalizedWindow } : {}),
    ...(normalizedAgentContext ? { agentContext: normalizedAgentContext } : {}),
  };
  const id = `voice-shortcut:${(await sha256(JSON.stringify(metadata))).slice(0, 32)}`;

  return {
    id,
    content: text,
    createdAt: new Date(activationBucketMs).toISOString(),
    type: 'voice',
    metadata: {
      source: getEventSourceMetadata(),
      inputSource: 'voice',
      inputMethod: 'recognition',
      voiceShortcut: metadata,
    },
  };
}
