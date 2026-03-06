export interface AudioBufferLike {
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface WavConvertOptions {
  targetSampleRate?: number;
  gain?: number;
}

const WAV_HEADER_SIZE = 44;
export const DEFAULT_ASR_TARGET_SAMPLE_RATE = 16000;
export const DEFAULT_ASR_GAIN = 4;

export function resampleFloat32(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
    throw new Error('sample rate must be positive');
  }

  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = Math.min(samples.length - 1, Math.floor(i * ratio));
    output[i] = samples[sourceIndex];
  }

  return output;
}

export function convertFloat32ToPcm16(samples: Float32Array, gain = 1): Int16Array {
  const pcmData = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i += 1) {
    const amplified = samples[i] * gain;
    const clamped = Math.max(-1, Math.min(1, amplified));
    pcmData[i] = clamped < 0
      ? Math.round(clamped * 0x8000)
      : Math.round(clamped * 0x7fff);
  }

  return pcmData;
}

export function encodePcm16ToWav(pcmData: Int16Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const numChannels = 1;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.byteLength;

  const buffer = new ArrayBuffer(WAV_HEADER_SIZE + dataSize);
  const view = new DataView(buffer);

  view.setUint32(0, 0x52494646, false);
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false);
  view.setUint32(12, 0x666d7420, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  view.setUint32(36, 0x64617461, false);
  view.setUint32(40, dataSize, true);

  const output = new Uint8Array(buffer);
  output.set(new Uint8Array(pcmData.buffer), WAV_HEADER_SIZE);
  return output;
}

export function convertAudioBufferToWav(
  audioBuffer: AudioBufferLike,
  options: WavConvertOptions = {},
): Uint8Array {
  const targetSampleRate = options.targetSampleRate ?? DEFAULT_ASR_TARGET_SAMPLE_RATE;
  const gain = options.gain ?? DEFAULT_ASR_GAIN;

  const rawData = audioBuffer.getChannelData(0);
  const resampled = resampleFloat32(rawData, audioBuffer.sampleRate, targetSampleRate);
  const pcmData = convertFloat32ToPcm16(resampled, gain);

  return encodePcm16ToWav(pcmData, targetSampleRate);
}

export async function convertWebmBlobToWav(
  webmBlob: Blob,
  options: WavConvertOptions = {},
): Promise<Uint8Array> {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const AudioContextCtor = globalThis.AudioContext;
  if (!AudioContextCtor) {
    throw new Error('AudioContext is unavailable in current runtime');
  }

  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return convertAudioBufferToWav(audioBuffer, options);
  } finally {
    await audioContext.close();
  }
}

export function readWavSampleRate(wavData: Uint8Array): number {
  if (wavData.length < WAV_HEADER_SIZE) {
    throw new Error('invalid wav data: header too short');
  }
  const view = new DataView(wavData.buffer, wavData.byteOffset, wavData.byteLength);
  return view.getUint32(24, true);
}
