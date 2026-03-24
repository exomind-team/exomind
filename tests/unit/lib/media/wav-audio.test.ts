import { describe, expect, it } from 'vitest';
import {
  convertAudioBufferToWav,
  convertFloat32ToPcm16,
  readWavSampleRate,
  resampleFloat32,
} from '@/lib/media/wav-audio';

describe('wav-audio utilities（WAV 音频预处理工具）', () => {
  it('resamples 48k audio to 16k length（48k 重采样到 16k）', () => {
    const input = new Float32Array(480);
    for (let i = 0; i < input.length; i += 1) {
      input[i] = i / input.length;
    }

    const result = resampleFloat32(input, 48000, 16000);

    expect(result.length).toBe(160);
  });

  it('applies gain and clamps to pcm16 range（应用增益并裁剪到 PCM16 范围）', () => {
    const input = new Float32Array([0.1, 0.4, 0.8, -0.9]);

    const result = convertFloat32ToPcm16(input, 4);

    expect(result[0]).toBeGreaterThan(12000);
    expect(result[1]).toBe(32767);
    expect(result[2]).toBe(32767);
    expect(result[3]).toBe(-32768);
  });

  it('encodes converted audio with target sample rate in wav header（WAV 头包含目标采样率）', () => {
    const data = new Float32Array(480);
    data.fill(0.25);

    const wav = convertAudioBufferToWav(
      {
        sampleRate: 48000,
        getChannelData: () => data,
      },
      {
        targetSampleRate: 16000,
        gain: 2,
      },
    );

    expect(readWavSampleRate(wav)).toBe(16000);
    expect(wav.length).toBeGreaterThan(44);
  });
});
