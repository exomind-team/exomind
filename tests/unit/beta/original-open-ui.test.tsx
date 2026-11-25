import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OriginalDownloads } from '@/beta/OriginalDownloads';
import { deferred, fakeClient } from './fixtures';

describe('B14-A02: file icon opens with the operating system', () => {
  it('opens once per explicit action, preserves Save As, and reports system refusal', async () => {
    const pending = deferred<void>();
    const open = vi.fn(() => pending.promise), save = vi.fn();
    const client = { ...fakeClient(), originalOpener: { open }, originalExports: { save, cancel: vi.fn() } };
    const original = { original_id: 'o', sha256: 'a'.repeat(64), byte_length: 1, file_name: 'document.txt', media_type: 'text/plain' };
    render(<OriginalDownloads client={client} profileId="p" originals={[original]} />);
    const button = screen.getByRole('button', { name: '打开 document.txt' });
    fireEvent.click(button);fireEvent.click(button);
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0]).toEqual(['p', 'o', expect.any(String)]);
    expect(save).not.toHaveBeenCalled();
    pending.reject(new Error('系统没有可打开此格式的应用'));
    expect(await screen.findByRole('alert')).toHaveTextContent('系统没有可打开此格式的应用');
    expect(button).toBeEnabled();
    expect(screen.getByRole('button', { name: '下载 document.txt' })).toBeEnabled();
  });

  it('collapses image file details by default and leaves non-previewable files expanded', () => {
    const client = fakeClient();
    const image = { original_id: 'image', sha256: 'b'.repeat(64), byte_length: 8, file_name: 'album.png', media_type: 'image/png' };
    const archive = { original_id: 'archive', sha256: 'c'.repeat(64), byte_length: 8, file_name: 'archive.zip', media_type: 'application/zip' };
    const view = render(<OriginalDownloads client={client} profileId="p" originals={[image]} />);

    expect(screen.queryByRole('button', { name: '下载 album.png' })).not.toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: '展开文件信息 album.png' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);
    expect(screen.getByRole('button', { name: '下载 album.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起文件信息 album.png' })).toHaveAttribute('aria-expanded', 'true');

    view.rerender(<OriginalDownloads client={client} profileId="p" originals={[archive]} />);
    expect(screen.getByRole('button', { name: '下载 archive.zip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /文件信息 archive\.zip/ })).not.toBeInTheDocument();
  });

  it('shares a ready event original through the owned Native action and reports only chooser handoff', async () => {
    const share = vi.fn(async () => 'system_chooser_opened' as const);
    const cancel = vi.fn(async () => false);
    const client = { ...fakeClient(), originalSharer: { share, cancel } };
    const original = { original_id: 'share-original', sha256: 'd'.repeat(64), byte_length: 12, file_name: 'document.txt', media_type: 'text/plain' };
    render(<OriginalDownloads client={client} profileId="p" originals={[original]} />);

    fireEvent.click(await screen.findByRole('button', { name: '分享 document.txt' }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith('p', 'share-original', expect.any(String));
    expect(await screen.findByText('已打开系统分享；接收应用尚未确认发送')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分享 document.txt' })).toBeEnabled();
  });

  it('offers cancellation while a Native share copy is being prepared and preserves the original row', async () => {
    let finishShare: ((outcome: 'system_chooser_opened' | 'cancelled') => void) | undefined;
    const share = vi.fn(() => new Promise<'system_chooser_opened' | 'cancelled'>(resolve => { finishShare = resolve; }));
    const cancel = vi.fn(async (_requestId: string) => { finishShare?.('cancelled'); return true; });
    const client = { ...fakeClient(), originalSharer: { share, cancel } };
    const original = { original_id: 'cancel-original', sha256: 'e'.repeat(64), byte_length: 14, file_name: 'cancel.txt', media_type: 'text/plain' };
    render(<OriginalDownloads client={client} profileId="p" originals={[original]} />);

    fireEvent.click(await screen.findByRole('button', { name: '分享 cancel.txt' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: '取消分享准备 cancel.txt' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(cancel).toHaveBeenCalledWith(expect.any(String));
    expect(await screen.findByText('分享准备已取消；原件保持不变')).toBeInTheDocument();
    expect(screen.getByText('cancel.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分享 cancel.txt' })).toBeEnabled();
  });
});
