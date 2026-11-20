import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BetaApiError } from '@/beta/api-error';
import { BetaSummarySourceDialog } from '@/beta/BetaSummarySourceDialog';
import type { BetaCorrectionEntry } from '@/beta/record-organization-client';
import type { BetaTimelineItem } from '@/beta/timeblocks-types';
import type { SummarySourceRef } from '@/beta/summary-types';

const P = '11111111-1111-4111-8111-111111111111';
const Q = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const E = '44444444-4444-4444-8444-444444444444';
const T = '55555555-5555-4555-8555-555555555555';
const HASH = 'a'.repeat(64);
const correctionRef: SummarySourceRef = { event_id: E, kind: 'correction/1', digest: HASH };

function correction(targetState: BetaCorrectionEntry['target_state'] = 'digest_conflict'): BetaCorrectionEntry {
  return {
    record: {
      event_id: E, profile_id: P, device_id: D, author_id: D, author_kind: 'human',
      occurred_at_ms: 1_794_560_000_000, target_event_id: T, target_digest: 'b'.repeat(64),
      corrected_text: 'synthetic corrected wording', digest: HASH, local_seq: 9,
    },
    target_state: targetState,
  };
}

function target(): BetaTimelineItem {
  return {
    kind: 'capture',
    record: {
      event_id: T, profile_id: P, device_id: D, author_id: D, author_kind: 'human',
      occurred_at_ms: 1_794_560_000_000, text: 'synthetic original wording', tags: [],
      digest: 'b'.repeat(64), local_seq: 4,
      originals: [{ original_id: '66666666-6666-4666-8666-666666666666', sha256: 'c'.repeat(64), byte_length: 12, file_name: 'voice.m4a', media_type: 'audio/mp4' }],
    },
  };
}

function view(props: Partial<ComponentProps<typeof BetaSummarySourceDialog>> = {}) {
  return <BetaSummarySourceDialog
    profileId={P}
    sourceProfileId={P}
    source={correctionRef}
    onClose={vi.fn()}
    now={1_794_560_000_100}
    dateMode="compact"
    {...props}
  />;
}

describe('summary correction source viewer', () => {
  it('shows an exact correction as its own fact and states digest conflict separately', async () => {
    const timelineReader = vi.fn(async () => target());
    const correctionReader = vi.fn(async () => correction('digest_conflict'));
    render(view({ reader: timelineReader, correctionReader }));

    expect(await screen.findByText('synthetic corrected wording')).toBeVisible();
    expect(screen.getByText(/摘要冲突/)).toBeVisible();
    expect(screen.getByText(/独立记录/)).toBeVisible();
    expect(timelineReader).not.toHaveBeenCalled();
    expect(correctionReader).toHaveBeenCalledWith(P, E, HASH);
  });

  it('shows missing and unsupported as separate outcomes', async () => {
    const missing = render(view({ correctionReader: vi.fn(async () => null) }));
    expect(await screen.findByText('本机没有可见的这条更正记录，未声称已读。')).toBeVisible();
    missing.unmount();

    render(view({ correctionReader: vi.fn(async () => { throw new BetaApiError('unsupported_correction_source', 'unsupported'); }) }));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前服务未声明精确更正来源读取能力');
  });

  it('opens the associated capture only on demand and keeps attachment metadata distinct from body reads', async () => {
    const timelineReader = vi.fn(async () => target());
    render(view({ reader: timelineReader, correctionReader: vi.fn(async () => correction('digest_matches')) }));
    fireEvent.click(await screen.findByRole('button', { name: '查看目标原文' }));

    expect(await screen.findByText('synthetic original wording')).toBeVisible();
    expect(screen.getByText(/原件清单仅为元数据/)).toBeVisible();
    expect(timelineReader).toHaveBeenCalledWith(P, T);
  });

  it('does not read a source after a cross-profile scope change and ignores the late result', async () => {
    let resolve!: (value: BetaCorrectionEntry) => void;
    const pending = new Promise<BetaCorrectionEntry>(done => { resolve = done; });
    const correctionReader = vi.fn(() => pending);
    const props = { correctionReader, onClose: vi.fn() };
    const rendered = render(view(props));
    await waitFor(() => expect(correctionReader).toHaveBeenCalledTimes(1));

    rendered.rerender(view({ ...props, profileId: Q }));
    await act(async () => { resolve(correction('digest_matches')); await pending; });
    expect(screen.queryByText('synthetic corrected wording')).not.toBeInTheDocument();
    expect(correctionReader).toHaveBeenCalledTimes(1);
  });

  it('does not start a read when the source belongs to a different profile scope', async () => {
    const correctionReader = vi.fn(async () => correction());
    const timelineReader = vi.fn(async () => target());
    render(view({ profileId: Q, sourceProfileId: P, reader: timelineReader, correctionReader }));
    await act(async () => {});
    expect(correctionReader).not.toHaveBeenCalled();
    expect(timelineReader).not.toHaveBeenCalled();
  });

  it('ignores a late exact read after close', async () => {
    let resolve!: (value: BetaCorrectionEntry) => void;
    const pending = new Promise<BetaCorrectionEntry>(done => { resolve = done; });
    const correctionReader = vi.fn(() => pending);
    const props = { correctionReader };
    const rendered = render(view(props));
    await waitFor(() => expect(correctionReader).toHaveBeenCalledTimes(1));
    rendered.rerender(view({ ...props, source: null, sourceProfileId: null }));
    await act(async () => { resolve(correction()); await pending; });
    expect(screen.queryByText('synthetic corrected wording')).not.toBeInTheDocument();
    expect(correctionReader).toHaveBeenCalledTimes(1);
  });
});
