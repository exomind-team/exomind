import { describe, expect, it, vi } from 'vitest';
import { nativeOriginalSharer } from '@/beta/original-share';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

describe('Native original sharing', () => {
  it('sends only profile/original/request identity and returns the system chooser phase', async () => {
    const call = vi.fn(async () => 'system_chooser_opened');
    const share = nativeOriginalSharer(call as unknown as Invoke);

    await expect(share.share('profile-a', 'original-a', 'request-a')).resolves.toBe('system_chooser_opened');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('beta_share_original', {
      profileId: 'profile-a',
      originalId: 'original-a',
      requestId: 'request-a',
    });
  });

  it('reports preparation cancellation as a separate outcome', async () => {
    const call = vi.fn(async () => 'cancelled');
    const share = nativeOriginalSharer(call as unknown as Invoke);

    await expect(share.share('profile-a', 'original-a', 'request-a')).resolves.toBe('cancelled');
  });

  it('cancels only the exact pending share request', async () => {
    const call = vi.fn(async () => true);
    const share = nativeOriginalSharer(call as unknown as Invoke);

    await expect(share.cancel('request-a')).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith('beta_cancel_original_share', { requestId: 'request-a' });
  });

  it('rejects an unknown Native share outcome rather than claiming handoff', async () => {
    const call = vi.fn(async () => ({ shared: true }));
    const share = nativeOriginalSharer(call as unknown as Invoke);

    await expect(share.share('profile-a', 'original-a', 'request-a')).rejects.toMatchObject({ code: 'invalid_share_result' });
  });
});
