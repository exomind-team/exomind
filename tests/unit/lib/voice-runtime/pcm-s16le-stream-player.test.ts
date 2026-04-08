import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('createPcmS16leStreamPlayer（PCM S16LE 流式播放器）', () => {
  let createdContexts: MockAudioContext[];
  let createdSources: MockBufferSourceNode[];

  class MockBufferSourceNode {
    buffer: unknown = null;
    onended: (() => void) | null = null;
    connect = vi.fn();
    disconnect = vi.fn();
    start = vi.fn();
    stop = vi.fn();

    constructor() {
      createdSources.push(this);
    }
  }

  class MockAudioContext {
    currentTime = 1;
    sampleRate: number;
    destination = {};
    state: AudioContextState = 'running';
    createBuffer = vi.fn((_channels: number, length: number, sampleRate: number) => ({
      sampleRate,
      getChannelData: (_channel: number) => new Float32Array(length),
    }));
    createBufferSource = vi.fn(() => new MockBufferSourceNode());
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    close = vi.fn(async () => {
      this.state = 'closed';
    });

    constructor(options?: AudioContextOptions) {
      this.sampleRate = options?.sampleRate ?? 24000;
      createdContexts.push(this);
    }
  }

  beforeEach(() => {
    vi.resetModules();
    createdContexts = [];
    createdSources = [];
    vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
  });

  it('queues PCM chunks onto a single audio timeline（把 PCM 音频块排到同一条时间线上）', async () => {
    const { createPcmS16leStreamPlayer } = await import('@/lib/voice-runtime/pcm-s16le-stream-player');
    const player = createPcmS16leStreamPlayer({
      sampleRate: 24000,
    });

    await player.enqueuePcm16(new Uint8Array([0, 0, 255, 127]));
    await player.enqueuePcm16(new Uint8Array([0, 128, 0, 64]));

    expect(createdContexts).toHaveLength(1);
    expect(createdContexts[0].createBuffer).toHaveBeenCalledTimes(2);
    expect(createdSources).toHaveLength(2);
    expect(createdSources[0].start).toHaveBeenCalledTimes(1);
    expect(createdSources[1].start).toHaveBeenCalledTimes(1);
  });

  it('interrupts active playback and closes cleanly（可以打断当前播放并正常释放）', async () => {
    const { createPcmS16leStreamPlayer } = await import('@/lib/voice-runtime/pcm-s16le-stream-player');
    const player = createPcmS16leStreamPlayer({
      sampleRate: 24000,
    });

    await player.enqueuePcm16(new Uint8Array([0, 0, 255, 127]));
    await player.interrupt();

    expect(createdSources[0].stop).toHaveBeenCalledTimes(1);
    expect(createdSources[0].disconnect).toHaveBeenCalledTimes(1);

    await player.dispose();
    expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
  });
});
