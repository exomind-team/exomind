import { describe, expect, it } from 'vitest';

import {
  KNOWN_AGENT_HUB_TOPICS,
  VOICE_RUNTIME_MODE_CHANGED_TOPIC,
  VOICE_RUNTIME_SPEAK_CANCEL_TOPIC,
  VOICE_RUNTIME_SPEAK_REQUEST_TOPIC,
  VOICE_RUNTIME_STATE_UPDATED_TOPIC,
  VOICE_STREAM_PARTIAL_TOPIC,
} from '@/lib/constants/signal-topics';
import type {
  NormalizedVoicePerception,
  ProviderRawPerception,
} from '@/lib/voice-runtime/types';

describe('voice runtime types and signal topics（语音运行时类型与信号主题）', () => {
  it('defines the raw provider perception shape（定义 Provider 原始感知结构）', () => {
    const rawPerception: ProviderRawPerception = {
      provider: 'doubao-o2-realtime',
      model: 'doubao-realtime-o2',
      eventType: 'session.started',
      payload: {
        sessionId: 'session-1',
      },
      capturedAt: '2026-04-08T00:00:00.000Z',
    };

    expect(rawPerception.provider).toBe('doubao-o2-realtime');
    expect(rawPerception.eventType).toBe('session.started');
    expect(rawPerception.payload).toEqual({ sessionId: 'session-1' });
  });

  it('defines the normalized perception shape（定义标准化感知结构）', () => {
    const normalizedPerception: NormalizedVoicePerception = {
      traceId: 'trace-1',
      provider: 'doubao-o2-realtime',
      transcript: '你好，外心',
      isFinal: true,
      emotion: 'calm',
      arousal: 0.32,
      speakingStyle: 'neutral',
      confidence: 0.98,
      providerMeta: {
        segmentId: 'segment-1',
      },
    };

    expect(normalizedPerception.traceId).toBe('trace-1');
    expect(normalizedPerception.transcript).toBe('你好，外心');
    expect(normalizedPerception.isFinal).toBe(true);
  });

  it('registers the new signal topics for runtime voice flow（注册语音运行时主题）', () => {
    expect(VOICE_STREAM_PARTIAL_TOPIC).toBe('voice.stream.partial');
    expect(VOICE_RUNTIME_STATE_UPDATED_TOPIC).toBe('voice.runtime.state.updated');
    expect(VOICE_RUNTIME_MODE_CHANGED_TOPIC).toBe('voice.runtime.mode.changed');
    expect(VOICE_RUNTIME_SPEAK_REQUEST_TOPIC).toBe('voice.runtime.speak.request');
    expect(VOICE_RUNTIME_SPEAK_CANCEL_TOPIC).toBe('voice.runtime.speak.cancel');

    expect(KNOWN_AGENT_HUB_TOPICS).toEqual(expect.arrayContaining([
      VOICE_STREAM_PARTIAL_TOPIC,
      VOICE_RUNTIME_STATE_UPDATED_TOPIC,
      VOICE_RUNTIME_MODE_CHANGED_TOPIC,
      VOICE_RUNTIME_SPEAK_REQUEST_TOPIC,
      VOICE_RUNTIME_SPEAK_CANCEL_TOPIC,
    ]));
  });
});
