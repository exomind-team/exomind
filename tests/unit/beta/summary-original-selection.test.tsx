import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SummaryOriginalSelection } from '@/beta/SummaryOriginalSelection';
import type { BetaClient } from '@/beta/client';
import type { BetaTimelinePage } from '@/beta/timeblocks-types';
import { A, B, D, E, N, O, P, R } from './summary-client-fixtures';
import { deferred, fakeClient } from './fixtures';

afterEach(cleanup);
const selection = { block_ids: [B], from_ms: 10, to_ms: 20, selected_original_ids: [] };
const image = { original_id: A, sha256: 'a'.repeat(64), byte_length: 68, file_name: 'synthetic.png', media_type: 'image/png' };
function fixture() {
  const page: BetaTimelinePage = { highwater: 1, next_before: null, items: [{ kind: 'capture', record: {
    event_id: E, profile_id: P, device_id: D, author_id: D, author_kind: 'human', occurred_at_ms: 15,
    text: 'Synthetic metadata', tags: [], digest: 'b'.repeat(64), local_seq: 1, originals: [image],
  } }] };
  let revision = N;
  const readOriginal = vi.fn(async () => new Uint8Array());
  const timelinePeriodPage = vi.fn(async () => page);
  const client: BetaClient = { ...fakeClient(), status:vi.fn(async()=>({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true,capabilities:{summary_originals:true}})), timelinePeriodPage,
    summaryModel: { read: vi.fn(async () => ({ profile_id: P, revision, enabled: true, include_suggestions: false,
      base_url: 'https://synthetic.invalid/v1', model: 'synthetic-vision', has_api_key: true, max_output_tokens: 2048, timeout_ms: 10000 })),
      save: vi.fn(async () => { throw Error('not this operation'); }) },
    originals: { readOriginal, readStage: vi.fn(async () => new Uint8Array()),
      begin: vi.fn(async () => { throw Error('not this operation'); }), status: vi.fn(async () => { throw Error('not this operation'); }),
      write: vi.fn(async () => { throw Error('not this operation'); }), verify: vi.fn(async () => { throw Error('not this operation'); }) },
  };
  return { client, page, readOriginal, timelinePeriodPage, changeRevision: () => { revision = R; } };
}

describe('explicit summary original consent', () => {
  it('supports an enabled provider configuration that does not require an API key', async () => {
    const f=fixture(),changed=vi.fn();
    vi.mocked(f.client.summaryModel!.read).mockResolvedValue({profile_id:P,revision:N,enabled:true,include_suggestions:false,base_url:'http://127.0.0.1:11434/v1',model:'synthetic-vision',has_api_key:false,max_output_tokens:2048,timeout_ms:10000});
    render(<SummaryOriginalSelection client={f.client} profileId={P} selection={selection} disabled={false} onChange={changed}/>);
    fireEvent.click(screen.getByRole('button',{name:'选择给模型的原件'}));
    expect(await screen.findByRole('checkbox',{name:/synthetic\.png/})).toBeEnabled();
    expect(f.readOriginal).not.toHaveBeenCalled();
  });
  it('reports an older Host capability before querying provider configuration or original references', async () => {
    const f = fixture(), changed = vi.fn();
    vi.mocked(f.client.status).mockResolvedValue({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true,capabilities:{summary_originals:false}});
    render(<SummaryOriginalSelection client={f.client} profileId={P} selection={selection} disabled={false} onChange={changed}/>);
    fireEvent.click(screen.getByRole('button',{name:'选择给模型的原件'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前服务尚未提供原件外发确认能力');
    expect(f.client.summaryModel!.read).not.toHaveBeenCalled();
    expect(f.timelinePeriodPage).not.toHaveBeenCalled();
  });
  it('loads metadata on demand, never reads bytes, and invalidates consent when selection changes', async () => {
    const f = fixture(), changed = vi.fn();
    render(<SummaryOriginalSelection client={f.client} profileId={P} selection={selection} disabled={false} onChange={changed}/>);
    expect(f.timelinePeriodPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '选择给模型的原件' }));
    const original = await screen.findByRole('checkbox', { name: /synthetic\.png/ });
    expect(original).not.toBeChecked();
    fireEvent.click(original);
    expect(changed).toHaveBeenLastCalledWith({ ids: [A], consent: null });
    fireEvent.click(screen.getByRole('checkbox', { name: /同意.*所选原件.*发送/ }));
    expect(changed).toHaveBeenLastCalledWith({ ids: [A], consent: { provider_config_revision: N, max_original_bytes: 68 } });
    fireEvent.click(original);
    expect(changed).toHaveBeenLastCalledWith({ ids: [], consent: null });
    expect(f.readOriginal).not.toHaveBeenCalled();
  });
  it('does not publish a late catalog result after its dialog leaves', async () => {
    const f = fixture(), gate = deferred<BetaTimelinePage>(), changed = vi.fn();
    f.timelinePeriodPage.mockReturnValueOnce(gate.promise);
    const ui = render(<SummaryOriginalSelection client={f.client} profileId={P} selection={selection} disabled={false} onChange={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: '选择给模型的原件' }));
    await waitFor(() => expect(f.timelinePeriodPage).toHaveBeenCalledTimes(1));
    ui.unmount(); const count = changed.mock.calls.length;
    await act(async () => { gate.resolve(f.page); await gate.promise; });
    expect(changed).toHaveBeenCalledTimes(count);
    expect(f.readOriginal).not.toHaveBeenCalled();
  });
  it('drops the previous profile selection even when its parent reuses the component', async () => {
    const f = fixture(), changed = vi.fn();
    const ui = render(<SummaryOriginalSelection client={f.client} profileId={P} selection={selection} disabled={false} onChange={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: '选择给模型的原件' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /synthetic\.png/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /同意.*所选原件.*发送/ }));
    ui.rerender(<SummaryOriginalSelection client={f.client} profileId={O} selection={selection} disabled={false} onChange={changed}/>);
    expect(screen.queryByRole('checkbox', { name: /synthetic\.png/ })).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith({ ids: [], consent: null });
  });
  it('clears approval on provider refresh and makes unsupported or oversized files unavailable for selection', async () => {
    const f = fixture(), changed = vi.fn();
    if (f.page.items[0].kind !== 'capture') throw Error('fixture kind');
    f.page.items[0].record.originals!.push(
      { ...image, original_id: O, file_name: 'unsupported.pdf', media_type: 'application/pdf' },
      { ...image, original_id: R, file_name: 'large.png', byte_length: 256 * 1024 + 1 },
    );
    render(<SummaryOriginalSelection client={f.client} profileId={P} selection={selection} disabled={false} onChange={changed}/>);
    fireEvent.click(screen.getByRole('button', { name: '选择给模型的原件' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /synthetic\.png/ }));
    expect(screen.getByRole('checkbox', { name: /unsupported\.pdf/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /large\.png/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /同意.*所选原件.*发送/ }));
    f.changeRevision(); fireEvent.click(screen.getByRole('button', { name: '重新核对原件与模型' }));
    expect(changed).toHaveBeenLastCalledWith({ ids: [], consent: null });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /synthetic\.png/ })).not.toBeChecked());
    expect(f.readOriginal).not.toHaveBeenCalled();
  });
});
