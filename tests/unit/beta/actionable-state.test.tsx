import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const RAW_DIAGNOSTIC = {
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

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function installClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

function restoreClipboard() {
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
}

afterEach(() => {
  cleanup();
  restoreClipboard();
});

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
    render(
      <BetaActionableState
        state="private"
        title="私有档案"
        detail="仅当前档案成员可见。"
        diagnostic={RAW_DIAGNOSTIC}
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

  it('renders an enabled copy action without a callback for pending/error/unknown/private and suppresses it for success/warning', () => {
    for (const state of ['pending', 'error', 'unknown', 'private'] as const) {
      const view = render(
        <BetaActionableState state={state} title="标题" diagnostic={REDACTED} />,
      );
      expect(screen.getByRole('button', { name: '复制诊断' })).toBeEnabled();
      view.unmount();
    }

    for (const state of ['success', 'warning'] as const) {
      const view = render(
        <BetaActionableState state={state} title="标题" diagnostic={REDACTED} />,
      );
      expect(screen.queryByRole('button', { name: '复制诊断' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('copies only the re-sanitized allowlist JSON through the built-in fallback', async () => {
    const writeText = vi.fn(async (_value: string) => undefined);
    installClipboard(writeText);

    render(
      <BetaActionableState
        state="private"
        title="私有档案"
        diagnostic={RAW_DIAGNOSTIC}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '复制诊断' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const copied = writeText.mock.calls[0][0] as string;
    expect(JSON.parse(copied)).toEqual({
      operation: 'peer_sync',
      code: 'E0425',
      deviceId: 'dev-1111',
      profileId: 'profile-',
      candidate: 'Beta25',
      lastStage: 'uploading',
      timestampMs: 1732176000000,
    });
    for (const leaked of [
      'fake-secret-value',
      'PRIVATE_PROFILE_BODY',
      'PRIVATE_CONTENT_BYTES',
      'PROFILE_BODY',
      'TOKEN',
      'INVITATION_SECRET',
    ]) {
      expect(copied).not.toContain(leaked);
    }
  });

  it('truthfully reports clipboard unavailability without a callback and keeps the copy action enabled', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

    render(
      <BetaActionableState state="error" title="连接失败" diagnostic={REDACTED} />,
    );

    const copy = screen.getByRole('button', { name: '复制诊断' });
    fireEvent.click(copy);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        '此窗口不支持剪贴板，请手动复制诊断详情',
      ),
    );
    expect(copy).toBeEnabled();
  });

  it('disables action buttons when onAction is absent but keeps the fallback copy enabled', () => {
    render(
      <BetaActionableState
        state="error"
        title="连接失败"
        actions={[{ id: 'retry', label: '重试连接' }]}
        diagnostic={REDACTED}
      />,
    );

    expect(screen.getByRole('button', { name: '重试连接' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '复制诊断' })).toBeEnabled();
  });
});
