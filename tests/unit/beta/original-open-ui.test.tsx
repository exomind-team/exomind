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
});
