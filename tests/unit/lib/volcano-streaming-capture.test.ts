import { describe, expect, it } from 'vitest';
import { PcmChunkAccumulator } from '@/lib/asr/volcano-streaming-capture';

describe('PcmChunkAccumulator（火山流式 PCM 分包器）', () => {
  it('emits 200ms PCM chunks and flushes the remainder（按 200ms 输出 PCM 分包并在 stop 时刷出余量）', () => {
    const accumulator = new PcmChunkAccumulator({ samplesPerChunk: 4 });

    const firstChunks = accumulator.append(new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]));
    expect(firstChunks).toHaveLength(1);
    expect(Array.from(new Int16Array(firstChunks[0].buffer.slice(0)))).toEqual([0, 16383, -16384, 32767]);

    const secondChunks = accumulator.append(new Float32Array([0.1, -0.1]));
    expect(secondChunks).toHaveLength(1);
    expect(Array.from(new Int16Array(secondChunks[0].buffer.slice(0)))).toEqual([-32768, 8191, 3276, -3276]);

    expect(accumulator.flush()).toBeNull();
  });

  it('returns trailing samples on flush when chunk is incomplete（未满一个 chunk 时在 flush 输出尾包）', () => {
    const accumulator = new PcmChunkAccumulator({ samplesPerChunk: 4 });

    accumulator.append(new Float32Array([0.25, -0.25, 0.75]));
    const finalChunk = accumulator.flush();

    expect(finalChunk).not.toBeNull();
    expect(Array.from(new Int16Array(finalChunk!.buffer.slice(0)))).toEqual([8191, -8192, 24575]);
  });
});
