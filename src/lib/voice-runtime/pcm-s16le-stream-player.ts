export interface PcmS16leStreamPlayer {
  enqueuePcm16(chunk: Uint8Array): Promise<void>;
  interrupt(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreatePcmS16leStreamPlayerOptions {
  sampleRate?: number;
  channelCount?: number;
  audioContextFactory?: (options?: AudioContextOptions) => AudioContext;
}

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNEL_COUNT = 1;

function createAudioContext(
  options: CreatePcmS16leStreamPlayerOptions,
): AudioContext {
  const audioContextFactory = options.audioContextFactory
    ?? ((contextOptions?: AudioContextOptions) => {
      const AudioContextCtor = globalThis.AudioContext;
      if (!AudioContextCtor) {
        throw new Error('AudioContext is unavailable in current runtime');
      }
      return new AudioContextCtor(contextOptions);
    });
  return audioContextFactory({
    sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
  });
}

function decodePcmS16leToFloat32(chunk: Uint8Array): Float32Array {
  const sampleCount = Math.floor(chunk.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true);
    samples[index] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }

  return samples;
}

export function createPcmS16leStreamPlayer(
  options: CreatePcmS16leStreamPlayerOptions = {},
): PcmS16leStreamPlayer {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channelCount = options.channelCount ?? DEFAULT_CHANNEL_COUNT;
  let context: AudioContext | null = null;
  let nextStartTime = 0;
  const activeSources = new Set<AudioBufferSourceNode>();

  function ensureContext(): AudioContext {
    if (!context) {
      context = createAudioContext(options);
    }
    return context;
  }

  async function enqueuePcm16(chunk: Uint8Array): Promise<void> {
    if (chunk.byteLength === 0) {
      return;
    }

    const runtime = ensureContext();
    if (runtime.state === 'suspended') {
      await runtime.resume();
    }

    const channelData = decodePcmS16leToFloat32(chunk);
    const audioBuffer = runtime.createBuffer(channelCount, channelData.length, sampleRate);
    audioBuffer.getChannelData(0).set(channelData);

    const source = runtime.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(runtime.destination);
    source.onended = () => {
      activeSources.delete(source);
      source.disconnect();
    };

    const scheduledStartTime = Math.max(runtime.currentTime, nextStartTime);
    source.start(scheduledStartTime);
    nextStartTime = scheduledStartTime + (audioBuffer.length / audioBuffer.sampleRate);
    activeSources.add(source);
  }

  async function interrupt(): Promise<void> {
    for (const source of activeSources) {
      try {
        source.stop();
      } catch {
        // Ignore sources that already ended.（已结束节点忽略 stop 错误）
      }
      source.disconnect();
    }
    activeSources.clear();
    nextStartTime = context?.currentTime ?? 0;
  }

  async function dispose(): Promise<void> {
    await interrupt();
    if (!context) {
      return;
    }
    await context.close();
    context = null;
  }

  return {
    enqueuePcm16,
    interrupt,
    dispose,
  };
}
