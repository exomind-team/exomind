import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLCANO_ASR_OPTIONS,
  VOLCANO_ENDPOINT_OPTIONS,
  VOLCANO_RESOURCE_PRESETS,
  buildVolcanoHttpRequestPayload,
} from '@/lib/asr/volcano-config';

describe('volcano-config', () => {
  it('defaults to the optimized async endpoint with two-pass recognition enabled', () => {
    expect(DEFAULT_VOLCANO_ASR_OPTIONS.endpoint).toBe('bigmodel_async');
    expect(DEFAULT_VOLCANO_ASR_OPTIONS.enableNonstream).toBe(true);
    expect(DEFAULT_VOLCANO_ASR_OPTIONS.showUtterances).toBe(true);
  });

  it('exposes official 1.0 and 2.0 resource presets', () => {
    expect(VOLCANO_RESOURCE_PRESETS.map((item) => item.value)).toEqual([
      'volc.bigasr.sauc.duration',
      'volc.bigasr.sauc.concurrent',
      'volc.seedasr.sauc.duration',
      'volc.seedasr.sauc.concurrent',
    ]);
  });

  it('keeps the endpoint menu aligned with official websocket paths', () => {
    expect(VOLCANO_ENDPOINT_OPTIONS.map((item) => item.value)).toEqual([
      'bigmodel_async',
      'bigmodel',
      'bigmodel_nostream',
    ]);
  });

  it('builds a browser payload that includes both audio and runtime config', () => {
    const payload = buildVolcanoHttpRequestPayload(
      new Uint8Array([1, 2, 3]),
      {
        appKey: 'app-key',
        accessKey: 'access-key',
        resourceId: 'volc.seedasr.sauc.duration',
        language: 'zh-CN',
      },
      {
        endpoint: 'bigmodel_async',
        enableNonstream: true,
        showUtterances: true,
        endWindowSize: 800,
        forceToSpeechTime: 1000,
      }
    );

    expect(payload.audioBase64).toBe('AQID');
    expect(payload.config.appKey).toBe('app-key');
    expect(payload.config.endpoint).toBe('bigmodel_async');
    expect(payload.config.request.enable_nonstream).toBe(true);
    expect(payload.config.request.show_utterances).toBe(true);
    expect(payload.config.request.end_window_size).toBe(800);
    expect(payload.config.request.force_to_speech_time).toBe(1000);
  });
});
