import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BetaAttachmentProgress } from '@/beta/BetaAttachmentProgress';
import type { BetaAttachmentProgress as ProgressState } from '@/beta/drafts';

afterEach(cleanup);

const queued = (stage: 'preparation' | 'upload'): ProgressState => ({
  phase: 'queued', completed: null, total: 1024, startedAt: 0, phaseStartedAt: 0, updatedAt: 0,
  queue: { kind: 'queued', stage, position: 2 },
});

describe('Beta attachment queue progress', () => {
  it('shows preparation queue position without claiming the item is stalled', () => {
    render(<BetaAttachmentProgress name="image.png" progress={queued('preparation')} active now={20_000} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('等待本机副本处理');
    expect(status).toHaveTextContent('队列位置 2');
    expect(status).not.toHaveTextContent('尚无新进度');
    expect(status).not.toHaveTextContent('可取消后重试');
  });

  it('distinguishes upload queue and automatic retry wait', () => {
    const { rerender } = render(<BetaAttachmentProgress name="image.png" progress={queued('upload')} active now={20_000} />);
    expect(screen.getByRole('status')).toHaveTextContent('等待附件暂存');
    expect(screen.getByRole('status')).toHaveTextContent('队列位置 2');

    rerender(<BetaAttachmentProgress name="image.png" active now={20_000} progress={{
      phase: 'queued', completed: null, total: 1024, startedAt: 0, phaseStartedAt: 0, updatedAt: 0,
      queue: { kind: 'retry', stage: 'upload', retryIndex: 2, retryDelayMs: 500 },
    }} />);
    expect(screen.getByRole('status')).toHaveTextContent('等待自动重试');
    expect(screen.getByRole('status')).toHaveTextContent('将在 500 毫秒后自动重试（2/3）');
    expect(screen.getByRole('status')).not.toHaveTextContent('尚无新进度');
  });
});
