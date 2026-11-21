import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BetaActionableState } from '@/beta/BetaActionableState';
import type { RedactedDiagnostic } from '@/beta/redacted-diagnostic';

const REDACTED: RedactedDiagnostic = {
  operation: 'peer_sync',
  code: 'E0425',
  deviceId: 'dev-1111',
  profileId: 'profile-',
  candidate: 'Beta25',
  lastStage: 'uploading',
  timestampMs: 1732176000000,
};

afterEach(() => cleanup());

describe('BetaActionableState', () => {
  it('renders an executable retry and a deterministic copy-diagnostic action, both enabled, for a blocking error', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onCopyDiagnostic = vi.fn(async () => 'copied' as const);

    render(
      <BetaActionableState
        state="error"
        title="连接失败"
        detail="无法连接到对端，请重试。"
        actions={[{ id: 'retry', label: '重试连接' }]}
        diagnostic={REDACTED}
        onAction={onAction}
        onCopyDiagnostic={onCopyDiagnostic}
      />,
    );

    const retry = screen.getByRole('button', { name: '重试连接' });
    const copy = screen.getByRole('button', { name: '复制诊断' });
    expect(retry).toBeEnabled();
    expect(copy).toBeEnabled();

    await user.click(retry);
    expect(onAction).toHaveBeenCalledWith('retry');
  });

  it('keeps a private state visible while protected body text stays absent and copy diagnostic stays available', () => {
    const rawDiagnostic = {
      operation: 'peer_sync',
      code: 'E0425',
      deviceId: 'dev-11111111111111111111111111111111',
      profileId: 'profile-22222222222222222222222222222222',
      candidate: 'Beta25',
      lastStage: 'uploading',
      timestampMs: 1732176000000,
      secret: 'fake-secret-value',
      body: 'PRIVATE_PROFILE_BODY',
      content: 'PRIVATE_CONTENT_BYTES',
      profileBody: 'PROFILE_BODY',
      token: 'TOKEN',
      invitationSecret: 'INVITATION_SECRET',
      originalBytes: new Uint8Array([1, 2, 3]),
    } as unknown as RedactedDiagnostic;

    render(
      <BetaActionableState
        state="private"
        title="私有档案"
        detail="仅当前档案成员可见。"
        diagnostic={rawDiagnostic}
        onCopyDiagnostic={vi.fn(async () => 'copied' as const)}
      />,
    );

    expect(screen.getByText('私有档案')).toBeInTheDocument();
    expect(screen.getByText('仅当前档案成员可见。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制诊断' })).toBeEnabled();
    expect(screen.getByText('dev-1111')).toBeInTheDocument();

    for (const leaked of [
      'PRIVATE_PROFILE_BODY',
      'PRIVATE_CONTENT_BYTES',
      'PROFILE_BODY',
      'TOKEN',
      'INVITATION_SECRET',
      'fake-secret-value',
    ]) {
      expect(screen.queryByText(leaked)).not.toBeInTheDocument();
    }
  });

  it('announces copy success and failure truthfully and keeps a retry path', async () => {
    const user = userEvent.setup();
    const onCopyDiagnostic = vi
      .fn<() => Promise<'copied' | 'failed'>>()
      .mockResolvedValueOnce('copied')
      .mockResolvedValueOnce('failed')
      .mockRejectedValueOnce(new Error('clipboard blocked'));

    render(
      <BetaActionableState
        state="error"
        title="连接失败"
        diagnostic={REDACTED}
        onCopyDiagnostic={onCopyDiagnostic}
      />,
    );

    const copy = screen.getByRole('button', { name: '复制诊断' });

    await user.click(copy);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('诊断已复制'));
    expect(copy).toBeEnabled();

    await user.click(copy);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('复制失败，可重试'));
    expect(copy).toBeEnabled();

    await user.click(copy);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('复制失败，可重试'));
    expect(copy).toBeEnabled();
    expect(onCopyDiagnostic).toHaveBeenCalledTimes(3);
  });
});
