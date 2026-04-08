import { describe, expect, it } from 'vitest';

import { normalizeVoiceRuntimePerception } from '@/lib/voice-runtime/normalize-perception';
import type { ProviderRawPerception } from '@/lib/voice-runtime/types';

describe('normalizeVoiceRuntimePerception（标准化语音运行时感知）', () => {
  it('maps ASRResponse interim results to partial perception（把 ASRResponse 中间识别结果映射为 partial）', () => {
    const rawPerception: ProviderRawPerception = {
      provider: 'doubao-o2-realtime',
      model: '1.2.1.1',
      eventType: 'ASRResponse',
      payload: {
        results: [
          {
            text: '今天晚上的计划',
            is_interim: true,
            confidence: 0.91,
          },
        ],
      },
      capturedAt: '2026-04-08T11:00:00.000Z',
    };

    expect(
      normalizeVoiceRuntimePerception(rawPerception, 'trace-partial'),
    ).toEqual(expect.objectContaining({
      traceId: 'trace-partial',
      provider: 'doubao-o2-realtime',
      transcript: '今天晚上的计划',
      isFinal: false,
      confidence: 0.91,
      providerMeta: rawPerception.payload,
    }));
  });

  it('maps ASRResponse final results to final perception（把 ASRResponse 最终识别事件映射为 final）', () => {
    const rawPerception: ProviderRawPerception = {
      provider: 'doubao-o2-realtime',
      model: '1.2.1.1',
      eventType: 'ASRResponse',
      payload: {
        question_id: 'question-1',
        results: [
          {
            text: '今天晚上的计划是先写设计文档。',
            is_interim: false,
            confidence: 0.97,
          },
        ],
      },
      capturedAt: '2026-04-08T11:00:01.000Z',
    };

    expect(
      normalizeVoiceRuntimePerception(rawPerception, 'trace-final'),
    ).toEqual(expect.objectContaining({
      traceId: 'trace-final',
      transcript: '今天晚上的计划是先写设计文档。',
      isFinal: true,
      confidence: 0.97,
      providerMeta: rawPerception.payload,
    }));
  });

  it('ignores unrelated provider events（忽略无关事件）', () => {
    const rawPerception: ProviderRawPerception = {
      provider: 'doubao-o2-realtime',
      model: '1.2.1.1',
      eventType: 'SessionStarted',
      payload: {
        dialog_id: 'dialog-1',
      },
      capturedAt: '2026-04-08T11:00:02.000Z',
    };

    expect(
      normalizeVoiceRuntimePerception(rawPerception, 'trace-ignore'),
    ).toBeNull();
  });
});
