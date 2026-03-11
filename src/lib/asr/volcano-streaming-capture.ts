export class PcmChunkAccumulator {
  private readonly samplesPerChunk: number;
  private pendingSamples: number[] = [];

  constructor(options: { samplesPerChunk?: number } = {}) {
    this.samplesPerChunk = options.samplesPerChunk ?? 3200;
  }

  append(samples: Float32Array): Uint8Array[] {
    for (const sample of samples) {
      this.pendingSamples.push(sample);
    }

    const chunks: Uint8Array[] = [];
    while (this.pendingSamples.length >= this.samplesPerChunk) {
      const nextSamples = this.pendingSamples.splice(0, this.samplesPerChunk);
      chunks.push(encodeSamplesToPcm(nextSamples));
    }
    return chunks;
  }

  flush(): Uint8Array | null {
    if (this.pendingSamples.length === 0) {
      return null;
    }

    const finalSamples = this.pendingSamples.splice(0, this.pendingSamples.length);
    return encodeSamplesToPcm(finalSamples);
  }
}

export interface VolcanoStreamingCapture {
  start(): Promise<void>;
  stop(): Promise<Uint8Array | null>;
  cancel(): Promise<void>;
}

export function createVolcanoStreamingCapture(options: {
  stream: MediaStream;
  onChunk: (chunk: Uint8Array) => Promise<void>;
  onLevel?: (level: number) => void;
  audioContextFactory?: (options: AudioContextOptions) => AudioContext;
  samplesPerChunk?: number;
}): VolcanoStreamingCapture {
  const audioContextFactory = options.audioContextFactory ?? ((contextOptions) => new AudioContext(contextOptions));
  const accumulator = new PcmChunkAccumulator({ samplesPerChunk: options.samplesPerChunk });

  let audioContext: AudioContext | null = null;
  let mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  let scriptProcessor: ScriptProcessorNode | null = null;
  let started = false;

  const release = async () => {
    if (scriptProcessor) {
      scriptProcessor.disconnect();
      scriptProcessor = null;
    }
    if (mediaStreamSource) {
      mediaStreamSource.disconnect();
      mediaStreamSource = null;
    }
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }
  };

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;

      audioContext = audioContextFactory({ sampleRate: 16000 });
      mediaStreamSource = audioContext.createMediaStreamSource(options.stream);
      scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(audioContext.destination);

      scriptProcessor.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        options.onLevel?.(measureAudioLevel(channelData));
        const chunks = accumulator.append(channelData);
        for (const chunk of chunks) {
          void options.onChunk(chunk);
        }
      };

      mediaStreamSource.connect(scriptProcessor);
      scriptProcessor.connect(silentGain);
    },

    async stop() {
      if (!started) {
        return null;
      }
      started = false;
      await release();
      return accumulator.flush();
    },

    async cancel() {
      if (!started) {
        return;
      }
      started = false;
      accumulator.flush();
      await release();
    },
  };
}

function measureAudioLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  return Math.max(0, Math.min(1, rms * 4));
}

function encodeSamplesToPcm(samples: number[]): Uint8Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}
