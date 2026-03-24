import { describe, expect, it, vi } from 'vitest';
import {
  PREFERRED_AUDIO_MIME_TYPES,
  createCompatibleMediaRecorder,
  getUserMediaWithConstraintFallback,
  pickSupportedAudioMimeType,
} from '@/lib/media/microphone-capture';

describe('getUserMediaWithConstraintFallback', () => {
  it('falls back to audio:true when preferred constraints are not supported（约束不兼容时自动回退）', async () => {
    const stream = {} as MediaStream;
    const preferredConstraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    };

    const getUserMedia = vi
      .fn<(_constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce({ name: 'OverconstrainedError' })
      .mockResolvedValueOnce(stream);

    const result = await getUserMediaWithConstraintFallback(getUserMedia, preferredConstraints);

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, preferredConstraints);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
  });

  it('rethrows permission denial errors without fallback（拒绝授权错误不应被吞掉）', async () => {
    const deniedError = { name: 'NotAllowedError' };
    const getUserMedia = vi
      .fn<(_constraints: MediaStreamConstraints) => Promise<MediaStream>>()
      .mockRejectedValueOnce(deniedError);

    await expect(
      getUserMediaWithConstraintFallback(getUserMedia, { audio: { channelCount: 1 } })
    ).rejects.toBe(deniedError);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe('pickSupportedAudioMimeType', () => {
  it('returns the first supported preferred mime type（返回首个可用编码）', () => {
    const isTypeSupported = vi.fn((mimeType: string) => mimeType === 'audio/mp4');

    const selected = pickSupportedAudioMimeType(isTypeSupported);

    expect(selected).toBe('audio/mp4');
    expect(isTypeSupported).toHaveBeenCalledWith(PREFERRED_AUDIO_MIME_TYPES[0]);
    expect(isTypeSupported).toHaveBeenCalledWith(PREFERRED_AUDIO_MIME_TYPES[1]);
    expect(isTypeSupported).toHaveBeenCalledWith(PREFERRED_AUDIO_MIME_TYPES[2]);
  });
});

describe('createCompatibleMediaRecorder', () => {
  it('uses preferred mime type when recorder supports it（可用时优先使用最佳编码）', () => {
    const stream = {} as MediaStream;
    const recorder = { mimeType: 'audio/webm;codecs=opus' } as MediaRecorder;
    const createRecorder = vi.fn().mockReturnValue(recorder);

    const result = createCompatibleMediaRecorder(stream, {
      createRecorder,
      isTypeSupported: (mimeType) => mimeType === 'audio/webm;codecs=opus',
    });

    expect(createRecorder).toHaveBeenCalledTimes(1);
    expect(createRecorder).toHaveBeenCalledWith(stream, { mimeType: 'audio/webm;codecs=opus' });
    expect(result.recorder).toBe(recorder);
    expect(result.mimeType).toBe('audio/webm;codecs=opus');
  });

  it('falls back to default recorder constructor when preferred mime fails（首选编码失败时回退默认构造）', () => {
    const stream = {} as MediaStream;
    const fallbackRecorder = { mimeType: 'audio/mp4' } as MediaRecorder;
    const createRecorder = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('Not supported'), { name: 'NotSupportedError' });
      })
      .mockReturnValueOnce(fallbackRecorder);

    const result = createCompatibleMediaRecorder(stream, {
      createRecorder,
      isTypeSupported: (mimeType) => mimeType === 'audio/webm;codecs=opus',
    });

    expect(createRecorder).toHaveBeenCalledTimes(2);
    expect(createRecorder).toHaveBeenNthCalledWith(1, stream, { mimeType: 'audio/webm;codecs=opus' });
    expect(createRecorder).toHaveBeenNthCalledWith(2, stream);
    expect(result.recorder).toBe(fallbackRecorder);
    expect(result.mimeType).toBe('audio/mp4');
  });
});
