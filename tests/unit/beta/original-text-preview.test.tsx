import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it, vi } from 'vitest';
import { OriginalDownloads } from '@/beta/OriginalDownloads';
import { BetaTextPreview } from '@/beta/BetaTextPreview';
import type { BetaOriginalAcquisitionClient, BetaOriginalTransferStatus } from '@/beta/original-acquisition';
import type { BetaOriginalClient } from '@/beta/original-types';
import {
  decodeTextPreview,
  isTextPreviewCandidate,
  MAX_TEXT_PREVIEW_BYTES,
  textPreviewPage,
  textPreviewPageCount,
  TEXT_PREVIEW_PAGE_CHARACTERS,
} from '@/beta/text-preview';
import { deferred, fakeClient } from './fixtures';

function digest(bytes: Uint8Array): string {
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function originalReader(read: BetaOriginalClient['readOriginal']) {
  const client = {
    begin: async () => { throw new Error('unused'); },
    status: async () => { throw new Error('unused'); },
    write: async () => { throw new Error('unused'); },
    verify: async () => { throw new Error('unused'); },
    readStage: async () => { throw new Error('unused'); },
    readOriginal: vi.fn(read),
  } satisfies BetaOriginalClient;
  return client;
}

function readerForBytes(bytes: Uint8Array) {
  return originalReader(async (_profileId, _originalId, offset, length) => bytes.slice(offset, offset + length));
}

function original(bytes: Uint8Array, fileName = 'note.md', mediaType = 'text/plain', originalId = 'text-original') {
  return { original_id: originalId, sha256: digest(bytes), byte_length: bytes.byteLength, file_name: fileName, media_type: mediaType };
}

function previewButton(fileName = 'note.md') {
  return screen.getByRole('button', { name: `预览文本 ${fileName}` });
}

function previewBody() {
  return screen.getByTestId('beta-text-preview-body');
}

describe('verified original text preview', () => {
  it('recognizes named text formats and leaves unknown octet-stream originals outside text preview', () => {
    expect(isTextPreviewCandidate('report.txt', 'application/octet-stream')).toBe(true);
    expect(isTextPreviewCandidate('report.md', 'text/plain; charset=utf-8')).toBe(true);
    expect(isTextPreviewCandidate('data.json', 'application/json')).toBe(true);
    expect(isTextPreviewCandidate('service.log', 'application/octet-stream')).toBe(true);
    expect(isTextPreviewCandidate('diagram.svg', 'image/svg+xml')).toBe(true);
    expect(isTextPreviewCandidate('archive.opaque', 'application/octet-stream')).toBe(false);
  });

  it('decodes strict UTF-8, strips a leading BOM, and preserves line endings', async () => {
    const text = '\uFEFF第一行\r\n第二行';
    expect(await decodeTextPreview(new Blob([new TextEncoder().encode(text)]))).toBe('第一行\r\n第二行');
    expect(await decodeTextPreview(new Blob([]))).toBe('');
  });

  it('rejects invalid UTF-8, binary control bytes, and a byte-length mismatch with distinct reasons', async () => {
    await expect(decodeTextPreview(new Blob([Uint8Array.from([0x61, 0xff])]))).rejects.toThrow('有效的 UTF-8');
    await expect(decodeTextPreview(new Blob([Uint8Array.from([0x61, 0x00, 0x62])]))).rejects.toThrow('二进制控制字节');
    await expect(decodeTextPreview(new Blob(['short']), 8)).rejects.toThrow('长度与记录不一致');
  });

  it('bounds preview allocation independently and reconstructs every surrogate-safe page', () => {
    expect(MAX_TEXT_PREVIEW_BYTES).toBe(1024 * 1024);
    const text = `${'x'.repeat(TEXT_PREVIEW_PAGE_CHARACTERS - 1)}😀tail`;
    const pages = Array.from({ length: textPreviewPageCount(text) }, (_, index) => textPreviewPage(text, index));
    expect(pages).toHaveLength(2);
    expect(pages.join('')).toBe(text);
    expect(pages[0].endsWith('😀')).toBe(true);
    expect(textPreviewPage(text, -1)).toBe('');
  });

  it('offers an explicit, lazy preview and renders HTML-like content as literal text', async () => {
    const text = '<script>window.previewExecuted = true</script>\r\n你好';
    const bytes = new TextEncoder().encode(text);
    const originals = readerForBytes(bytes);
    const opener = vi.fn(async () => {});
    const client = { ...fakeClient(), originals, originalOpener: { open: opener } };
    const attachment = original(bytes);

    render(<OriginalDownloads client={client} profileId="profile-current" deviceId="device-current" originals={[attachment]} />);

    expect(originals.readOriginal).not.toHaveBeenCalled();
    fireEvent.click(previewButton());

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(originals.readOriginal).toHaveBeenCalledWith('profile-current', 'text-original', 0, bytes.byteLength));
    expect(dialog.querySelector('pre')?.textContent).toBe(text);
    expect(dialog.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '打开 note.md' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下载 note.md' })).toBeEnabled();
    expect(opener).not.toHaveBeenCalled();
  });

  it('strips a UTF-8 BOM while preserving Chinese characters and CRLF line endings', async () => {
    const text = '\uFEFF{"标题":"外心"}\r\n第二行';
    const bytes = new TextEncoder().encode(text);
    const io = readerForBytes(bytes);
    render(<OriginalDownloads client={{ ...fakeClient(), originals: io }} profileId="p" originals={[original(bytes, 'data.json', 'application/json')]} />);
    fireEvent.click(previewButton('data.json'));
    await screen.findByRole('dialog');
    await waitFor(() => expect(previewBody().textContent).toBe('{"标题":"外心"}\r\n第二行'));
  });

  it('shows a valid empty original as empty without inventing a first byte', async () => {
    const bytes = new Uint8Array();
    const io = readerForBytes(bytes);
    render(<OriginalDownloads client={{ ...fakeClient(), originals: io }} profileId="p" originals={[original(bytes, 'empty.txt')]} />);
    fireEvent.click(previewButton('empty.txt'));
    expect(await screen.findByText('此原件为空。')).toBeInTheDocument();
    expect(io.readOriginal).toHaveBeenCalledWith('p', 'text-original', 0, 1);
  });

  it('uses a preview-specific budget and leaves larger originals to the existing full-file actions', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(2 * 1024 * 1024));
    const io = readerForBytes(bytes);
    const item = original(bytes);
    render(<OriginalDownloads client={{ ...fakeClient(), originals: io }} profileId="p" originals={[item]} />);
    fireEvent.click(previewButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('1 MiB');
    expect(io.readOriginal).not.toHaveBeenCalled();
  });

  it('does not decode late bytes after the preview component leaves',async()=>{
    const pending=deferred<Blob>(),decode=vi.spyOn(TextDecoder.prototype,'decode');
    const ui=render(<BetaTextPreview identity="owned" visible fileName="note.txt" mediaType="text/plain" byteLength={4} load={()=>pending.promise}/>);
    try {
      fireEvent.click(previewButton('note.txt'));ui.unmount();
      const before=decode.mock.calls.length;
      await act(async()=>{pending.resolve(new Blob(['late']));});
      expect(decode.mock.calls.length).toBe(before);
    } finally {decode.mockRestore();ui.unmount();}
  });

  it('releases ready text on close and re-reads only after a new explicit request',async()=>{
    const load=vi.fn(async()=>new Blob(['body']));
    render(<BetaTextPreview identity="owned" visible fileName="note.txt" mediaType="text/plain" byteLength={4} load={load}/>);
    fireEvent.click(previewButton('note.txt'));await screen.findByTestId('beta-text-preview-body');
    fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(previewButton('note.txt'));await screen.findByTestId('beta-text-preview-body');expect(load).toHaveBeenCalledTimes(2);
  });

  it('releases ready text while its record view is hidden',async()=>{
    const load=vi.fn(async()=>new Blob(['body'])),props={identity:'owned',fileName:'note.txt',mediaType:'text/plain',byteLength:4,load};
    const ui=render(<BetaTextPreview {...props} visible/>);
    fireEvent.click(previewButton('note.txt'));await screen.findByTestId('beta-text-preview-body');
    ui.rerender(<BetaTextPreview {...props} visible={false}/>);ui.rerender(<BetaTextPreview {...props} visible/>);
    fireEvent.click(previewButton('note.txt'));await screen.findByTestId('beta-text-preview-body');expect(load).toHaveBeenCalledTimes(2);
  });

  it('renders a large complete source in surrogate-safe segments with both navigation edges', async () => {
    const pageLimit = TEXT_PREVIEW_PAGE_CHARACTERS;
    const chunkSize = 256 * 1024;
    const beforeChunkBoundary = 'a'.repeat(chunkSize - 1);
    const beforePageBoundary = 'b'.repeat(pageLimit - 1);
    const text = `${beforeChunkBoundary}你${beforePageBoundary}😀END`;
    const bytes = new TextEncoder().encode(text);
    const io = readerForBytes(bytes);
    render(<OriginalDownloads client={{ ...fakeClient(), originals: io }} profileId="p" originals={[original(bytes, 'long.log', 'text/plain')]} />);
    fireEvent.click(previewButton('long.log'));
    await screen.findByRole('dialog');
    const count=textPreviewPageCount(text),rendered:string[]=[];
    expect(await screen.findByText(`分段 1 / ${count}`)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'上一段'})).toBeDisabled();
    for(let index=0;index<count;index++) {
      rendered.push(previewBody().textContent??'');
      if(index<count-1) {
        previewBody().scrollTop=123;
        fireEvent.click(screen.getByRole('button',{name:'下一段'}));
        expect(await screen.findByText(`分段 ${index+2} / ${count}`)).toBeInTheDocument();
        expect(previewBody().scrollTop).toBe(0);
      }
    }
    expect(rendered.join('')).toBe(text);
    expect(screen.getByRole('button',{name:'下一段'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '上一段' }));
    expect(await screen.findByText(`分段 ${count-1} / ${count}`)).toBeInTheDocument();
    expect(io.readOriginal).toHaveBeenCalledTimes(Math.ceil(bytes.byteLength / (256 * 1024)));
  });

  it.each([
    ['invalid UTF-8', Uint8Array.from([0x61, 0xff]), '有效的 UTF-8'],
    ['binary control bytes', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]), '二进制'],
  ] as const)('reports %s clearly and keeps the original actions available', async (_case, bytes, reason) => {
    const io = readerForBytes(bytes);
    render(<OriginalDownloads client={{ ...fakeClient(), originals: io }} profileId="p" originals={[original(bytes, 'content.txt')]} />);
    fireEvent.click(previewButton('content.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '下载 content.txt' })).toBeEnabled();
  });

  it('does not offer a read preview while the existing acquisition status says the local original is missing', async () => {
    const bytes = new TextEncoder().encode('remote copy only');
    const item = original(bytes);
    const missing: BetaOriginalTransferStatus = {
      profile_id: 'p', original_id: item.original_id, original: item, availability: 'missing', next_offset: 0,
      byte_length: item.byte_length, request_id: null, peer_device_id: null, transfer_state: 'idle', last_error_code: null,
    };
    const acquisition = {
      status: vi.fn(async () => missing),
      sources: vi.fn(async () => ({ network_enabled: true, devices: ['authorized-device'] })),
      fetch: vi.fn(async () => ({ original: item, verified: false, resumed_from: 0, transferred_bytes: 0 })),
      cancel: vi.fn(async () => false),
    } satisfies BetaOriginalAcquisitionClient;
    render(<OriginalDownloads client={{ ...fakeClient(), originalAcquisition: acquisition }} profileId="p" originals={[item]} />);
    await screen.findByText('本机缺少原件，仅有记录信息');
    expect(screen.queryByRole('button', { name: '预览文本 note.md' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '获取原件' })).toBeEnabled();
    expect(acquisition.fetch).not.toHaveBeenCalled();
  });

  it('reports a missing local read and keeps the original actions available', async () => {
    const bytes = new TextEncoder().encode('still here');
    const io = originalReader(async () => { throw new Error('本机没有完整原件'); });
    render(<OriginalDownloads client={{ ...fakeClient(), originals: io }} profileId="p" originals={[original(bytes)]} />);
    fireEvent.click(previewButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('本机没有完整原件');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '下载 note.md' })).toBeEnabled();
  });

  it('keeps text preview selective while unknown binary and image originals retain their existing actions', () => {
    const text = new TextEncoder().encode('text');
    const binary = Uint8Array.from([0, 255, 1]);
    const image = Uint8Array.from([1, 2, 3]);
    const io = readerForBytes(text);
    const client = { ...fakeClient(), originals: io, originalOpener: { open: vi.fn(async () => {}) } };
    render(<OriginalDownloads client={client} profileId="p" originals={[
      original(text, 'readme.txt', 'text/plain', 'txt'),
      original(binary, 'archive.opaque', 'application/octet-stream', 'bin'),
      original(image, 'diagram.png', 'image/png', 'image'),
    ]} />);
    expect(previewButton('readme.txt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预览文本 archive.opaque' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开 archive.opaque' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下载 archive.opaque' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '预览图片 diagram.png' })).toBeEnabled();
  });

  it('returns focus to its trigger on close and ignores a late successful read', async () => {
    const bytes = new TextEncoder().encode('late success');
    let release!: (value: Uint8Array) => void;
    const pending = new Promise<Uint8Array>(resolve => { release = resolve; });
    const io = originalReader(() => pending);
    render(<OriginalDownloads client={{ ...fakeClient(), originals: io }} profileId="p" originals={[original(bytes)]} />);
    const trigger = previewButton();
    fireEvent.click(trigger);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    await act(async () => { release(bytes); await pending; });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('late success')).not.toBeInTheDocument();
  });

  it.each([
    ['client', 'success'], ['client', 'failure'], ['profile/device scope', 'success'], ['profile/device scope', 'failure'],
  ] as const)('after switching %s, ignores a late %s from the prior object', async (switchKind, resultKind) => {
    const bytes = new TextEncoder().encode('current scope data');
    const delayed = deferred<Uint8Array>();
    const staleIo = originalReader(profileId => profileId === 'profile-old' ? delayed.promise : Promise.reject(new Error('new object read failed')));
    const currentIo = originalReader(async () => { throw new Error('new object read failed'); });
    const item = original(bytes);
    const staleClient = { ...fakeClient(), originals: staleIo };
    const currentClient = switchKind === 'client' ? { ...fakeClient(), originals: currentIo } : staleClient;
    const view = render(<OriginalDownloads client={staleClient} profileId="profile-old" deviceId="device-old" originals={[item]} />);
    fireEvent.click(previewButton());
    await screen.findByRole('dialog');
    await waitFor(() => expect(staleIo.readOriginal).toHaveBeenCalledOnce());
    view.rerender(<OriginalDownloads client={currentClient} profileId={switchKind === 'client' ? 'profile-old' : 'profile-new'} deviceId={switchKind === 'client' ? 'device-old' : 'device-new'} originals={[item]} />);
    fireEvent.click(previewButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('new object read failed');
    await act(async () => {
      if (resultKind === 'success') delayed.resolve(bytes);
      else delayed.reject(new Error('stale object read failed'));
      await delayed.promise.catch(() => {});
    });
    expect(screen.getByRole('alert')).toHaveTextContent('new object read failed');
    expect(screen.queryByText('current scope data')).not.toBeInTheDocument();
  });

  it('does not publish a late failure after the pane becomes hidden', async () => {
    const bytes = new TextEncoder().encode('hidden data');
    const delayed = deferred<Uint8Array>();
    const io = originalReader(() => delayed.promise);
    const client = { ...fakeClient(), originals: io };
    const item = original(bytes);
    const view = render(<OriginalDownloads client={client} profileId="p" originals={[item]} />);
    fireEvent.click(previewButton());
    await screen.findByRole('dialog');
    await waitFor(() => expect(io.readOriginal).toHaveBeenCalledOnce());
    view.rerender(<OriginalDownloads client={client} profileId="p" originals={[item]} visible={false} />);
    await act(async () => { delayed.reject(new Error('hidden stale failure')); await delayed.promise.catch(() => {}); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries only the current source and re-reads after releasing a closed preview', async () => {
    const bytes = new TextEncoder().encode('recovered');
    const oldIo = originalReader(async () => { throw new Error('old source failed'); });
    const currentRead = vi.fn()
      .mockRejectedValueOnce(new Error('current source failed'))
      .mockResolvedValue(bytes);
    const currentIo = originalReader(currentRead);
    const item = original(bytes);
    const view = render(<OriginalDownloads client={{ ...fakeClient(), originals: oldIo }} profileId="p" originals={[item]} />);
    fireEvent.click(previewButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('old source failed');
    view.rerender(<OriginalDownloads client={{ ...fakeClient(), originals: currentIo }} profileId="p" originals={[item]} />);
    fireEvent.click(previewButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('current source failed');
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    expect(oldIo.readOriginal).toHaveBeenCalledTimes(1);
    expect(currentIo.readOriginal).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(previewButton());
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    expect(oldIo.readOriginal).toHaveBeenCalledTimes(1);
    expect(currentIo.readOriginal).toHaveBeenCalledTimes(3);
  });
});
