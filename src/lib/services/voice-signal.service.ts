import { getSelectedRuntimeTarget } from '@/config/runtime-target';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import type { ASRResult } from '@/lib/ports/asr-port';
import {
  VOICE_INPUT_TRANSCRIPT_TOPIC,
} from '@/lib/constants/signal-topics';

export interface PublishVoiceTranscriptOptions {
  source?: string;
  traceId?: string;
}

function buildRuntimeHostRecord(): RuntimeHostRecord {
  const runtimeTarget = getSelectedRuntimeTarget();
  return {
    id: `runtime-${runtimeTarget.mode}`,
    name: runtimeTarget.mode === 'embedded' ? 'Embedded Runtime（内嵌运行时）' : 'External Runtime（外部运行时）',
    host: runtimeTarget.host,
    port: runtimeTarget.port,
    status: 'online',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isLocal:
      runtimeTarget.mode === 'embedded'
      || runtimeTarget.host === '127.0.0.1'
      || runtimeTarget.host === 'localhost',
  };
}

function buildTraceId(traceId?: string): string {
  if (traceId?.trim()) return traceId.trim();
  const suffix = Math.random().toString(36).slice(2, 10);
  return `voice:${Date.now().toString(36)}:${suffix}`;
}

export async function publishVoiceTranscriptSignal(
  result: Pick<ASRResult, 'text'> & Partial<Pick<ASRResult, 'lang' | 'confidence' | 'duration'>>,
  options: PublishVoiceTranscriptOptions = {},
): Promise<void> {
  const text = result.text.trim();
  if (!text) return;

  const publisher = new SignalStreamService({
    host: buildRuntimeHostRecord(),
    agentId: 'voice-input',
  });

  const source = options.source?.trim() || 'frontend:voice-input-button';
  const traceId = buildTraceId(options.traceId);
  const payload = {
    text,
    transcript: text,
    lang: result.lang,
    confidence: result.confidence,
    duration: result.duration,
    inputMode: 'voice' as const,
  };

  await publisher.publish({
    topic: VOICE_INPUT_TRANSCRIPT_TOPIC,
    source,
    trace_id: traceId,
    payload,
  });
}
