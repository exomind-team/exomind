import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OriginalDownloads } from '@/beta/OriginalDownloads';
import { OriginalTransferDiagnostics } from '@/beta/OriginalTransferDiagnostics';
import type {
  BetaOriginalAcquisitionClient,
  BetaOriginalTransferStatus,
} from '@/beta/original-acquisition';
import type { BetaOriginal } from '@/beta/original-types';
import { deferred, fakeClient } from './fixtures';

const P = '11111111-1111-4111-8111-111111111111';
const Q = '55555555-5555-4555-8555-555555555555';
const O = '22222222-2222-4222-8222-222222222222';
const OQ = '66666666-6666-4666-8666-666666666666';
const D = '33333333-3333-4333-8333-333333333333';
const R = '44444444-4444-4444-8444-444444444444';
const original: BetaOriginal = {
  original_id: O,
  sha256: 'a'.repeat(64),
  byte_length: 8192,
  file_name: 'fixture.raw',
  media_type: 'application/octet-stream',
};
const otherOriginal: BetaOriginal = {
  ...original,
  original_id: OQ,
  sha256: 'b'.repeat(64),
  file_name: 'other-profile.raw',
};
const autoStatus = {
  network_enabled: true,
  policy_enabled: true,
  max_bytes: 8 * 1024 * 1024,
  active_outbound: 0,
  deferred: false,
  last_error_code: null,
};

function fixture(queueStatus: () => Promise<unknown>) {
  const status = vi.fn(async (profileId: string, originalId: string): Promise<BetaOriginalTransferStatus> => {
    const descriptor = profileId === Q ? otherOriginal : original;
    return {
      profile_id: profileId,
      original_id: originalId,
      original: descriptor,
      availability: 'missing',
      next_offset: 0,
      byte_length: descriptor.byte_length,
      request_id: null,
      peer_device_id: null,
      transfer_state: profileId === P ? 'failed' : 'idle',
      last_error_code: profileId === P ? 'peer_timeout' : null,
    };
  });
  const acquisition: BetaOriginalAcquisitionClient = {
    status,
    sources: vi.fn(async () => ({ network_enabled: true, devices: [D] })),
    fetch: vi.fn(async () => ({ original, verified: true, resumed_from: 0, transferred_bytes: 0 })),
    cancel: vi.fn(async () => true),
  };
  const client = {
    ...fakeClient(),
    originalAcquisition: acquisition,
    originalAutoDiagnostics: { status: queueStatus },
  };
  return { client, status, queueStatus };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('on-demand original transfer diagnostics', () => {
  it('shows peer_timeout and real status fields only after opening the detail', async () => {
    const queueStatus = vi.fn(async () => autoStatus);
    const f = fixture(queueStatus);
    const view = render(<OriginalDownloads client={f.client} profileId={P} originals={[original]} />);
    await screen.findByText('本机缺少原件，仅有记录信息');
    expect(queueStatus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '查看 fixture.raw 的传输诊断' }));
    expect(screen.getByRole('region', { name: 'fixture.raw 的传输诊断' })).toBeVisible();
    expect(await screen.findByText('peer_timeout')).toBeVisible();
    expect(screen.getByText(original.original_id)).toBeVisible();
    expect(screen.getByText(original.sha256)).toBeVisible();
    expect(screen.getByText('0 / 8192 B（0 B / 8.0 KiB）')).toBeVisible();
    expect(screen.getByText('8388608 B（8.0 MiB）')).toBeVisible();
    expect(screen.getAllByText('连接超时，请确认来源设备在线后重试；已收到的部分会保留').length).toBeGreaterThan(0);
    expect(screen.queryByText('来源设备身份与已确认授权不符；未放宽身份检查，请在同步页核对连接')).not.toBeInTheDocument();
    expect(queueStatus).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(queueStatus).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('ignores a late queue read after the detail closes, then reads once on explicit reopen', async () => {
    const pending = deferred<unknown>();
    const queueStatus = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(autoStatus);
    render(<OriginalDownloads client={fixture(queueStatus).client} profileId={P} originals={[original]} />);
    await screen.findByText('本机缺少原件，仅有记录信息');
    fireEvent.click(screen.getByRole('button', { name: '查看 fixture.raw 的传输诊断' }));
    await waitFor(() => expect(queueStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '收起 fixture.raw 的传输诊断' }));
    await act(async () => {
      pending.resolve({ ...autoStatus, deferred: true });
      await pending.promise;
    });
    expect(screen.queryByText('已标记延迟')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看 fixture.raw 的传输诊断' }));
    await screen.findByText('当前未标记延迟');
    expect(queueStatus).toHaveBeenCalledTimes(2);
  });

  it('drops a late result when the selected profile and original change', async () => {
    const pending = deferred<unknown>();
    const queueStatus = vi.fn().mockReturnValueOnce(pending.promise);
    const f = fixture(queueStatus);
    const view = render(<OriginalDownloads client={f.client} profileId={P} originals={[original]} />);
    await screen.findByText('本机缺少原件，仅有记录信息');
    fireEvent.click(screen.getByRole('button', { name: '查看 fixture.raw 的传输诊断' }));
    await waitFor(() => expect(queueStatus).toHaveBeenCalledTimes(1));

    view.rerender(<OriginalDownloads client={f.client} profileId={Q} originals={[otherOriginal]} />);
    await screen.findByText('本机缺少原件，仅有记录信息');
    await act(async () => {
      pending.resolve({ ...autoStatus, deferred: true });
      await pending.promise;
    });
    expect(screen.queryByText(original.original_id)).not.toBeInTheDocument();
    expect(screen.queryByText('已标记延迟')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'fixture.raw 的传输诊断' })).not.toBeInTheDocument();
    expect(queueStatus).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'hide'] as const)('does not dispatch a queued diagnostic read after immediate %s', async action => {
    const queueStatus = vi.fn(async () => autoStatus);
    const f = fixture(queueStatus);
    const view = render(<OriginalTransferDiagnostics client={f.client} profileId={P} original={original} visible />);
    fireEvent.click(screen.getByRole('button', { name: '查看 fixture.raw 的传输诊断' }));
    if (action === 'close') fireEvent.click(screen.getByRole('button', { name: '收起 fixture.raw 的传输诊断' }));
    else view.rerender(<OriginalTransferDiagnostics client={f.client} profileId={P} original={original} visible={false} />);
    await act(async () => { await Promise.resolve(); });
    expect(queueStatus).not.toHaveBeenCalled();
    expect(f.status).not.toHaveBeenCalled();
  });

  it('keeps an opened diagnostic snapshot when the card begins receiving', async () => {
    const f = fixture(vi.fn(async () => autoStatus));
    render(<OriginalDownloads client={f.client} profileId={P} originals={[original]} />);
    await screen.findByText('本机缺少原件，仅有记录信息');
    fireEvent.click(screen.getByRole('button', { name: '查看 fixture.raw 的传输诊断' }));
    await screen.findByText('8388608 B（8.0 MiB）');
    f.status.mockResolvedValue({
      profile_id:P, original_id:O, original, availability:'partial', next_offset:4096,
      byte_length:8192, request_id:R, peer_device_id:D, transfer_state:'receiving', last_error_code:null,
    });
    fireEvent.click(screen.getByRole('button', { name:'检查原件 fixture.raw' }));
    await screen.findByRole('button', { name:'取消获取' });
    expect(screen.getByRole('region', { name:'fixture.raw 的传输诊断' })).toBeVisible();
    expect(screen.getByText('8388608 B（8.0 MiB）')).toBeVisible();
    expect(f.queueStatus).toHaveBeenCalledTimes(1);
  });

  it('hides an unrecognized raw error string in the detail', async () => {
    const f = fixture(vi.fn(async () => autoStatus));
    f.status.mockImplementation(async (profileId, originalId) => ({
      profile_id: profileId,
      original_id: originalId,
      original,
      availability: 'missing',
      next_offset: 0,
      byte_length: original.byte_length,
      request_id: null,
      peer_device_id: null,
      transfer_state: 'failed',
      last_error_code: 'raw-token-secret',
    }));
    render(<OriginalDownloads client={f.client} profileId={P} originals={[original]} />);
    await screen.findByText('本机缺少原件，仅有记录信息');
    fireEvent.click(screen.getByRole('button', { name: '查看 fixture.raw 的传输诊断' }));
    expect(await screen.findByText('未知规范码；原始错误文本已隐藏')).toBeVisible();
    expect(document.body.textContent).not.toContain('raw-token-secret');
  });
});
