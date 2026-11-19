import { describe, expect, it, vi } from 'vitest';
import {
  evaluateMediaPreview,
  formatMediaTime,
  MAX_MEDIA_PREVIEW_BYTES,
  resolveMediaPreviewFormat,
} from '@/beta/media-preview';

describe('verified media preview policy', () => {
  it.each([
    ['voice.wav', 'audio/wav', { kind: 'audio', mimeType: 'audio/wav' }],
    ['voice.mp3', 'audio/mpeg', { kind: 'audio', mimeType: 'audio/mpeg' }],
    ['voice.ogg', 'audio/ogg; codecs=opus', { kind: 'audio', mimeType: 'audio/ogg' }],
    ['voice.webm', 'audio/webm', { kind: 'audio', mimeType: 'audio/webm' }],
    ['clip.webm', 'video/webm', { kind: 'video', mimeType: 'video/webm' }],
    ['clip.mp4', 'video/mp4', { kind: 'video', mimeType: 'video/mp4' }],
  ] as const)('allows an explicitly listed self-contained format: %s', (fileName, mediaType, format) => {
    expect(resolveMediaPreviewFormat(fileName, mediaType)).toEqual(format);
  });

  it.each([
    ['stream.m3u8', 'application/vnd.apple.mpegurl'],
    ['stream.m3u', 'audio/mpegurl'],
    ['stream.mp3', 'application/x-mpegurl'],
    ['list.xspf', 'application/xspf+xml'],
    ['page.html', 'text/html'],
    ['drawing.svg', 'image/svg+xml'],
    ['archive.opaque', 'application/octet-stream'],
    ['voice.mp3', 'application/octet-stream'],
    ['voice.ogg', 'application/ogg'],
    ['clip.mp4', 'audio/ogg'],
    ['voice.wav', 'audio/mpeg'],
    ['voice.constructor', 'constructor'],
  ])('rejects playlists, active/document formats, unknown codecs, and mismatched declarations: %s', (fileName, mediaType) => {
    expect(resolveMediaPreviewFormat(fileName, mediaType)).toBeNull();
  });

  it('checks the browser capability only after the independent 16 MiB and non-empty bounds', () => {
    const canPlayType = vi.fn(() => 'probably');
    const atLimit = evaluateMediaPreview({ fileName: 'voice.mp3', mediaType: 'audio/mpeg', byteLength: MAX_MEDIA_PREVIEW_BYTES, canPlayType });
    expect(atLimit).toMatchObject({ kind: 'supported', format: { kind: 'audio', mimeType: 'audio/mpeg' } });
    expect(canPlayType).toHaveBeenCalledWith('audio/mpeg');

    canPlayType.mockClear();
    expect(evaluateMediaPreview({ fileName: 'voice.mp3', mediaType: 'audio/mpeg', byteLength: MAX_MEDIA_PREVIEW_BYTES + 1, canPlayType }).kind).toBe('too-large');
    expect(evaluateMediaPreview({ fileName: 'voice.mp3', mediaType: 'audio/mpeg', byteLength: 0, canPlayType }).kind).toBe('empty');
    expect(evaluateMediaPreview({ fileName: 'voice.mp3', mediaType: 'audio/mpeg', byteLength: -1, canPlayType }).kind).toBe('invalid-size');
    expect(canPlayType).not.toHaveBeenCalled();
  });

  it('keeps browser codec uncertainty as an explicit unsupported decision', () => {
    expect(evaluateMediaPreview({
      fileName: 'clip.mp4',
      mediaType: 'video/mp4',
      byteLength: 1024,
      canPlayType: () => '',
    })).toMatchObject({ kind: 'unsupported-browser', format: { kind: 'video', mimeType: 'video/mp4' } });
  });

  it('treats nonstandard capability results as unsupported', () => {
    expect(evaluateMediaPreview({
      fileName: 'voice.wav',
      mediaType: 'audio/wav',
      byteLength: 1024,
      canPlayType: () => 'no',
    }).kind).toBe('unsupported-browser');
  });

  it('passes an explicit codec declaration to canPlayType and falls back when that codec is unknown', () => {
    const canPlayType = vi.fn((mimeType: string) => mimeType.includes('codec-that-does-not-exist') ? '' : 'probably');
    const plan = evaluateMediaPreview({
      fileName: 'clip.mp4',
      mediaType: 'video/mp4; codecs="codec-that-does-not-exist"',
      byteLength: 1024,
      canPlayType,
    });

    expect(canPlayType).toHaveBeenCalledWith('video/mp4; codecs="codec-that-does-not-exist"');
    expect(plan.kind).toBe('unsupported-browser');
  });

  it('formats known zero, ordinary times, long times, and unknown durations distinctly', () => {
    expect(formatMediaTime(0)).toBe('0:00');
    expect(formatMediaTime(61.8)).toBe('1:01');
    expect(formatMediaTime(3600)).toBe('1:00:00');
    expect(formatMediaTime(null)).toBe('--:--');
    expect(formatMediaTime(Number.NaN)).toBe('--:--');
    expect(formatMediaTime(Number.POSITIVE_INFINITY)).toBe('--:--');
  });
});
