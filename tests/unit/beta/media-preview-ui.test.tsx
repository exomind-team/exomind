import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { sha256 } from '@noble/hashes/sha2.js';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BetaMediaPreview } from '@/beta/BetaMediaPreview';
import { OriginalDownloads } from '@/beta/OriginalDownloads';
import type { BetaOriginalClient } from '@/beta/original-types';
import { MAX_MEDIA_PREVIEW_BYTES } from '@/beta/media-preview';
import { deferred, fakeClient } from './fixtures';

let nextUrl = 0;

beforeEach(() => {
  nextUrl = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:media-${++nextUrl}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

function previewButton(kind: 'audio' | 'video', fileName: string) {
  return screen.getByRole('button', { name: `预览${kind === 'audio' ? '音频' : '视频'} ${fileName}` });
}

function inlinePlayButton(fileName: string) {
  return screen.getByRole('button', { name: `播放 ${fileName}` });
}

function previewProps(overrides: Partial<ComponentProps<typeof BetaMediaPreview>> = {}) {
  return {
    identity: 'device:profile:original:sha256',
    fileName: 'voice.wav',
    mediaType: 'audio/wav',
    byteLength: 8,
    load: vi.fn(async () => new Blob([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'audio/wav' })),
    ...overrides,
  };
}

function setMediaReadings(media: HTMLMediaElement, duration: number, currentTime = 0) {
  Object.defineProperty(media, 'duration', { configurable: true, value: duration });
  Object.defineProperty(media, 'currentTime', { configurable: true, writable: true, value: currentTime });
}

function expectMediaTimes(current: string, duration: string) {
  const readings = screen.getByTestId('beta-media-time').querySelectorAll('time');
  expect(Array.from(readings, element => element.textContent)).toEqual([current, duration]);
}

function syntheticWav(): Uint8Array {
  const sampleRate = 8_000;
  const frameCount = sampleRate / 4;
  const dataLength = frameCount * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataLength, true);
  for (let frame = 0; frame < frameCount; frame++) {
    view.setInt16(44 + frame * 2, Math.round(Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 5_000), true);
  }
  return bytes;
}

describe('explicit verified media preview', () => {
  it('keeps video originals downloadable without offering an inline preview', () => {
    const readRange = vi.fn();
    const client = { ...fakeClient(), originals: { readRange } as unknown as BetaOriginalClient };
    render(<OriginalDownloads client={client} profileId="profile-current" deviceId="device-current" originals={[{
      original_id: 'video-original', file_name: 'clip.webm', media_type: 'video/webm',
      byte_length: 8, sha256: 'a'.repeat(64),
    }]} />);
    expect(screen.queryByRole('button', { name: '预览视频 clip.webm' })).toBeNull();
    expect(screen.getByRole('button', { name: '下载 clip.webm' })).toBeEnabled();
    expect(readRange).not.toHaveBeenCalled();
  });
  it('reads only after an explicit click and does not autoplay or expose native media controls', async () => {
    const props = previewProps();
    render(<BetaMediaPreview {...props} />);
    expect(props.load).not.toHaveBeenCalled();

    fireEvent.click(previewButton('audio', 'voice.wav'));
    const dialog = await screen.findByRole('dialog');
    const media = await screen.findByTestId('beta-media-element') as HTMLMediaElement;

    expect(props.load).toHaveBeenCalledTimes(1);
    expect(media.tagName).toBe('AUDIO');
    expect(media.getAttribute('src')).toBe('blob:media-1');
    expect(media).not.toHaveAttribute('controls');
    expect(media.autoplay).toBe(false);
    expect(media.paused).toBe(true);
    expect(dialog).toHaveTextContent('正在读取媒体信息');
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('plays verified synthetic audio from one contextual tap and never autoplays on mount', async () => {
    const bytes = syntheticWav();
    const load = vi.fn(async () => new Blob([bytes], { type: 'audio/wav' }));
    render(<BetaMediaPreview {...previewProps({ inline: true, byteLength: bytes.byteLength, load })} />);

    expect(load).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(inlinePlayButton('voice.wav'));

    const media = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    await waitFor(() => expect(media.play).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(media.autoplay).toBe(false);
    expect(media).not.toHaveAttribute('controls');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const previewBlob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(new Uint8Array(await previewBlob.arrayBuffer())).toEqual(bytes);

    fireEvent.playing(media);
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('正在播放');
    fireEvent.click(screen.getByRole('button', { name: '暂停 voice.wav' }));
    expect(media.pause).toHaveBeenCalledTimes(1);
  });

  it('uses recorder elapsed time only as a labeled hint and keeps unknown media duration unseekable', async () => {
    render(<BetaMediaPreview {...previewProps({ inline: true, durationHintMs: 5_000 })} />);
    fireEvent.click(inlinePlayButton('voice.wav'));
    const media = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    setMediaReadings(media, Number.NaN);
    fireEvent.loadedMetadata(media);

    expectMediaTimes('0:00', '--:--');
    expect(screen.getByTestId('beta-media-recording-duration')).toHaveTextContent('录音计时 0:05；媒体总时长尚未确认');
    expect(screen.getByRole('slider', { name: '播放位置（秒）' })).toBeDisabled();

    setMediaReadings(media, 12);
    fireEvent.loadedMetadata(media);
    expectMediaTimes('0:00', '0:12');
    expect(screen.queryByTestId('beta-media-recording-duration')).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '播放位置（秒）' })).toBeEnabled();
  });

  it('revokes the inline playback URL on close and unmount', async () => {
    const load = vi.fn(async () => new Blob([syntheticWav()], { type: 'audio/wav' }));
    const view = render(<BetaMediaPreview {...previewProps({ inline: true, byteLength: syntheticWav().byteLength, load })} />);
    fireEvent.click(inlinePlayButton('voice.wav'));
    const media = await screen.findByTestId('beta-media-element');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '收起播放器 voice.wav' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-1'));
    expect(media.pause).toHaveBeenCalled();

    fireEvent.click(inlinePlayButton('voice.wav'));
    await screen.findByTestId('beta-media-element');
    view.unmount();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-2'));
  });

  it('defers video without reading bytes or creating a playback object', () => {
    const props = previewProps({ fileName: 'clip.webm', mediaType: 'video/webm' });
    render(<BetaMediaPreview {...props} />);
    fireEvent.click(previewButton('video', 'clip.webm'));

    expect(previewButton('video', 'clip.webm')).toBeDisabled();
    expect(props.load).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByTestId('beta-media-element')).toBeNull();
    expect(screen.getByText(/^视频请使用系统打开或下载原件/)).toBeInTheDocument();
  });

  it('reports metadata, time updates, seeking, volume, pause, and ended from media event callbacks', async () => {
    const props = previewProps();
    render(<BetaMediaPreview {...props} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    const media = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    setMediaReadings(media, 42);
    fireEvent.loadedMetadata(media);

    expectMediaTimes('0:00', '0:42');
    expect(screen.getByRole('slider', { name: '播放位置（秒）' })).toBeEnabled();

    Object.defineProperty(media, 'currentTime', { configurable: true, writable: true, value: 7 });
    fireEvent.timeUpdate(media);
    expectMediaTimes('0:07', '0:42');

    const seek = screen.getByRole('slider', { name: '播放位置（秒）' });
    fireEvent.change(seek, { target: { value: '12' } });
    expect(media.currentTime).toBe(12);
    const volume = screen.getByRole('slider', { name: '音量（百分比）' });
    expect(seek).toHaveAttribute('type', 'range');
    expect(seek).toHaveAttribute('tabindex', '0');
    expect(volume).toHaveAccessibleName('音量（百分比）');
    expect(volume).toHaveAttribute('aria-valuetext', '100%');
    fireEvent.change(volume, { target: { value: '25' } });
    expect(media.volume).toBe(0.25);

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(media.play).toHaveBeenCalledTimes(1);
    fireEvent.play(media);
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('等待媒体');
    fireEvent.playing(media);
    expect(screen.getByRole('status')).toHaveTextContent('正在播放');
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(media.pause).toHaveBeenCalledTimes(1);
    fireEvent.pause(media);
    expect(screen.getByRole('status')).toHaveTextContent('已暂停');
    fireEvent.ended(media);
    expect(screen.getByRole('status')).toHaveTextContent('播放结束');
  });

  it('distinguishes unknown duration from a real zero and explains disabled seeking', async () => {
    const props = previewProps();
    render(<BetaMediaPreview {...props} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    const media = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    const seek = screen.getByRole('slider', { name: '播放位置（秒）' });
    expectMediaTimes('0:00', '--:--');
    expect(seek).toBeDisabled();
    expect(seek).toHaveClass('appearance-none');
    expect(seek).toHaveAccessibleName('播放位置（秒）');
    expect(seek).toHaveAttribute('aria-valuetext', '0 秒');
    expect(document.getElementById(seek.getAttribute('aria-describedby') ?? '')).toHaveTextContent('时长尚未读取');

    setMediaReadings(media, Number.NaN);
    fireEvent.loadedMetadata(media);
    expectMediaTimes('0:00', '--:--');
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('时长未确认');
    expect(document.getElementById(seek.getAttribute('aria-describedby') ?? '')).toHaveTextContent('浏览器未提供');

    setMediaReadings(media, 0);
    fireEvent.loadedMetadata(media);
    expectMediaTimes('0:00', '0:00');
    expect(seek).toBeDisabled();
    expect(document.getElementById(seek.getAttribute('aria-describedby') ?? '')).toHaveTextContent('原件时长为 0 秒');
  });

  it('keeps a rejected play request in an honest recoverable state', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('NotAllowedError'));
    const props = previewProps();
    render(<BetaMediaPreview {...props} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    await screen.findByTestId('beta-media-element');
    fireEvent.click(screen.getByRole('button', { name: '播放' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('浏览器未能开始播放');
    expect(screen.getByRole('alert')).toHaveTextContent('系统打开或下载');
    expect(screen.queryByText('正在播放')).not.toBeInTheDocument();
  });

  it('distinguishes an accepted play request, actual playback, and buffering', async () => {
    render(<BetaMediaPreview {...previewProps()} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    const media = await screen.findByTestId('beta-media-element');
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.play(media);
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('等待媒体');
    fireEvent.playing(media);
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('正在播放');
    fireEvent.waiting(media);
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('正在缓冲');
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled();
    fireEvent.playing(media);
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('正在播放');
  });

  it('reports a decoder error beside the media and preserves a usable preview surface', async () => {
    const props = previewProps();
    render(<BetaMediaPreview {...props} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    const media = await screen.findByTestId('beta-media-element');
    fireEvent.error(media);
    expect(await screen.findByRole('alert')).toHaveTextContent('浏览器无法解码此媒体');
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('does not turn a user pause into a playback failure when the pending play rejects', async () => {
    const playing = deferred<void>();
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValueOnce(playing.promise);
    render(<BetaMediaPreview {...previewProps()} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    const media = await screen.findByTestId('beta-media-element');
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    fireEvent.pause(media);
    await act(async () => {
      playing.reject(new DOMException('Playback was interrupted by pause', 'AbortError'));
      await playing.promise.catch(() => {});
    });
    expect(screen.getByTestId('beta-media-playback-status')).toHaveTextContent('已暂停');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not create a media URL when the verified local read rejects corrupt bytes', async () => {
    const props = previewProps({ load: vi.fn(async () => { throw new Error('原件完整性校验失败'); }) });
    render(<BetaMediaPreview {...props} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));

    expect(await screen.findByRole('alert')).toHaveTextContent('原件完整性校验失败');
    expect(screen.getByRole('alert')).toHaveTextContent('原件未修改');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects oversize sources before calling the supplied reader', () => {
    const load = vi.fn(async () => new Blob(['unused']));
    render(<BetaMediaPreview {...previewProps({ byteLength: MAX_MEDIA_PREVIEW_BYTES + 1, load })} />);

    expect(screen.getByRole('button', { name: '预览音频 voice.wav' })).toBeDisabled();
    expect(screen.getByText(/最多读取 16 MiB/)).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the existing file-row fallback visible when the browser rejects the media type', () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('');
    const props = previewProps({ fallbackActionMessage: '关闭后可下载原件' });
    render(<BetaMediaPreview {...props} />);

    expect(screen.getByRole('button', { name: '预览音频 voice.wav' })).toBeDisabled();
    expect(screen.getByText('此浏览器暂不支持该媒体格式；关闭后可下载原件')).toBeInTheDocument();
    expect(props.load).not.toHaveBeenCalled();
  });

  it('does not offer playlist previews or follow their external references', () => {
    const load = vi.fn(async () => new Blob(['#EXTM3U\nhttps://example.invalid/segment.ts']));
    const props = previewProps({ fileName: 'stream.m3u8', mediaType: 'application/vnd.apple.mpegurl', load });
    const view = render(<BetaMediaPreview {...props} />);

    expect(screen.queryByRole('button', { name: /预览/ })).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    view.unmount();
  });

  it('drops a late read when its source scope changes and never creates a stale Blob URL', async () => {
    const pending = deferred<Blob>();
    const oldScope = {}, newScope = {};
    const oldLoad = vi.fn(() => pending.promise);
    const nextLoad = vi.fn(async () => new Blob(['new'], { type: 'audio/wav' }));
    const first = previewProps({ sourceScope: oldScope, load: oldLoad });
    const view = render(<BetaMediaPreview {...first} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    await screen.findByRole('dialog');
    await waitFor(() => expect(oldLoad).toHaveBeenCalledTimes(1));

    view.rerender(<BetaMediaPreview {...first} identity="new-device:profile:original:new-hash" sourceScope={newScope} load={nextLoad} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { pending.resolve(new Blob(['stale'], { type: 'audio/wav' })); await pending.promise; });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(nextLoad).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('releases this preview on close, rereads on reopen, and ignores events from its prior element', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(new Blob(['first123'], { type: 'audio/wav' }))
      .mockResolvedValueOnce(new Blob(['second12'], { type: 'audio/wav' }));
    render(<BetaMediaPreview {...previewProps({ load })} />);
    const trigger = previewButton('audio', 'voice.wav');
    fireEvent.click(trigger);
    const firstMedia = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-1'));
    expect(firstMedia.getAttribute('src')).toBeNull();
    expect(firstMedia.pause).toHaveBeenCalled();

    fireEvent.click(trigger);
    const currentMedia = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    expect(load).toHaveBeenCalledTimes(2);
    setMediaReadings(currentMedia, 90, 4);
    fireEvent.loadedMetadata(currentMedia);
    Object.defineProperty(firstMedia, 'currentTime', { configurable: true, writable: true, value: 33 });
    fireEvent.timeUpdate(firstMedia);
    fireEvent.error(firstMedia);
    expectMediaTimes('0:04', '1:30');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('releases a ready object when hidden or replaced and ignores the old media object afterward', async () => {
    const oldScope = {}, nextScope = {};
    const oldLoad = vi.fn(async () => new Blob(['old-data'], { type: 'audio/wav' }));
    const nextLoad = vi.fn(async () => new Blob(['new-data'], { type: 'audio/wav' }));
    const oldProps = previewProps({ sourceScope: oldScope, load: oldLoad });
    const view = render(<BetaMediaPreview {...oldProps} />);
    fireEvent.click(previewButton('audio', 'voice.wav'));
    const oldMedia = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    setMediaReadings(oldMedia, 42, 4);
    fireEvent.loadedMetadata(oldMedia);

    view.rerender(<BetaMediaPreview {...oldProps} visible={false} />);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:media-1'));
    expect(oldMedia.getAttribute('src')).toBeNull();
    expect(oldMedia.pause).toHaveBeenCalled();
    expect(oldLoad).toHaveBeenCalledTimes(1);

    view.rerender(<BetaMediaPreview {...oldProps} identity="new-device:profile:original:new-hash" sourceScope={nextScope} load={nextLoad} visible />);
    fireEvent.error(oldMedia);
    expect(nextLoad).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(previewButton('audio', 'voice.wav'));
    const nextMedia = await screen.findByTestId('beta-media-element') as HTMLMediaElement;
    setMediaReadings(nextMedia, 90, 3);
    fireEvent.loadedMetadata(nextMedia);
    fireEvent.timeUpdate(oldMedia);
    fireEvent.error(oldMedia);
    expectMediaTimes('0:03', '1:30');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(nextLoad).toHaveBeenCalledTimes(1);
  });

  it('uses the verified local read path and does not invoke system open, export, acquisition, or capture', async () => {
    const bytes = syntheticWav();
    const readOriginal = vi.fn(async (_profileId: string, _originalId: string, offset: number, length: number) => bytes.slice(offset, offset + length));
    const originals = {
      begin: async () => { throw new Error('unused'); },
      status: async () => { throw new Error('unused'); },
      write: async () => { throw new Error('unused'); },
      verify: async () => { throw new Error('unused'); },
      readStage: async () => { throw new Error('unused'); },
      readOriginal,
    } satisfies BetaOriginalClient;
    const open = vi.fn(async () => {}), save = vi.fn(async () => ({ kind: 'native' as const, result: {} as never }));
    const client = { ...fakeClient(), originals, originalOpener: { open }, originalExports: { save, cancel: vi.fn() } };
    const original = {
      original_id: 'voice-original',
      sha256: Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join(''),
      byte_length: bytes.byteLength,
      file_name: 'voice.wav',
      media_type: 'audio/wav',
    };

    render(<OriginalDownloads client={client} profileId="profile-current" deviceId="device-current" originals={[original]} />);
    expect(readOriginal).not.toHaveBeenCalled();
    fireEvent.click(inlinePlayButton('voice.wav'));
    const media = await screen.findByTestId('beta-media-element');
    await waitFor(() => expect(media.play).toHaveBeenCalledTimes(1));

    expect(readOriginal).toHaveBeenCalledWith('profile-current', 'voice-original', 0, bytes.byteLength);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '收起播放器 voice.wav' }));
    expect(screen.getByRole('button', { name: '打开 voice.wav' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下载 voice.wav' })).toBeEnabled();
  });
});
