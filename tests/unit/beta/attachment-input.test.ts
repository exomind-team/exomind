import { describe, expect, it } from 'vitest';
import { clipboardImageFiles } from '@/beta/clipboard-images';

describe('B14-A01: file paste keeps arbitrary originals', () => {
  it('accepts opaque, typeless and image files in their original order without duplicating DataTransfer entries', () => {
    const files = [new File([], 'archive.zip', { type: 'application/zip' }), new File([], 'opaque.custom'), new File([], 'photo.png', { type: 'image/png' })];
    const data = { items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })), files } as unknown as DataTransfer;
    expect(clipboardImageFiles(data)).toEqual(files);
  });
  it('falls back to the files snapshot when WebView items cannot return files', () => {
    const file = new File([], 'report.txt', { type: 'text/plain' });
    const data = { items: [{ kind: 'file', type: '', getAsFile: () => null }], files: [file] } as unknown as DataTransfer;
    expect(clipboardImageFiles(data)).toEqual([file]);
  });
});
