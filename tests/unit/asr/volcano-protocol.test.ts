import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildVolcanoAudioFrame,
  buildVolcanoRequestFrame,
  isVolcanoFinalResponse,
  parseVolcanoServerFrame,
} from '@/lib/asr/volcano-protocol';

describe('volcano-protocol', () => {
  it('encodes the last audio packet with message type 2 and final flag 2', () => {
    const frame = buildVolcanoAudioFrame(new Uint8Array([1, 2, 3]), {
      isLast: true,
      useGzip: true,
    });

    expect(Array.from(frame.slice(0, 4))).toEqual([0x11, 0x22, 0x01, 0x00]);
  });

  it('encodes request frames with json serialization and gzip compression', () => {
    const frame = buildVolcanoRequestFrame({ hello: 'world' }, { useGzip: true });

    expect(Array.from(frame.slice(0, 4))).toEqual([0x11, 0x10, 0x11, 0x00]);
  });

  it('parses async final responses with flags=3 and gzip payload', () => {
    const payload = gzipSync(Buffer.from(JSON.stringify({
      audio_info: { duration: 5945 },
      result: { text: '你好，火山语音识别测试。今天天气很好。' },
    })));
    const header = new Uint8Array([0x11, 0x93, 0x11, 0x00]);
    const sequence = new Uint8Array([0x00, 0x00, 0x00, 0x04]);
    const size = new Uint8Array(4);
    new DataView(size.buffer).setUint32(0, payload.length, false);
    const frame = new Uint8Array(header.length + sequence.length + size.length + payload.length);
    frame.set(header, 0);
    frame.set(sequence, 4);
    frame.set(size, 8);
    frame.set(payload, 12);

    const parsed = parseVolcanoServerFrame(frame);

    expect(parsed.messageType).toBe(9);
    expect(parsed.flags).toBe(3);
    expect(parsed.sequence).toBe(4);
    expect(parsed.payloadJson?.result?.text).toBe('你好，火山语音识别测试。今天天气很好。');
    expect(isVolcanoFinalResponse(parsed, 'bigmodel_async')).toBe(true);
  });
});
