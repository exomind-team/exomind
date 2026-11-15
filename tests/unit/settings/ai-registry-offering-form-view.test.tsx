import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIRegistryOfferingFormView, type AIRegistryFormDraft } from '@/ui/app/components/settings/AIRegistryOfferingFormView';

// These factories run only if the View accidentally imports a legacy adapter.
vi.mock('@/config/llm-settings', () => { throw new Error('Pure View must not load legacy model settings'); });
vi.mock('@/lib/ai-registry/storage', () => { throw new Error('Pure View must not load legacy registry storage'); });
vi.mock('@/lib/ai-registry/admin', () => { throw new Error('Pure View must not load legacy registry actions'); });

const initial: AIRegistryFormDraft = { capabilityKey: 'review.summary', capabilityDisplayName: 'Review Summary', channelName: 'Synthetic review channel', vendor: 'openai', baseUrl: 'https://synthetic.example/v1', model: 'synthetic-review-model', apiKey: 'synthetic-secret', qualityScoreManual: '', stabilityLevelManual: '', latencyTierManual: '', notes: '', setAsDefault: false };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('shared Alpha offering editor with caller-owned adapters', () => {
  it('edits injected state and invokes only explicit adapter actions, without legacy config/storage or automatic saving', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('No storage read allowed'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('No storage write allowed'); });
    const save = vi.fn(), reset = vi.fn();
    function Editor() {
      const [draft, setDraft] = useState(initial);
      return <AIRegistryOfferingFormView draft={draft} onDraftChange={setDraft} capabilityOptions={[{ key: 'review.summary', displayName: 'Review Summary' }]} vendorOptions={['openai', 'synthetic-gateway']} error={null} onSave={() => save(draft)} onReset={() => { reset(); setDraft(initial); }}/>;
    }
    render(<Editor/>);
    expect(save).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue('synthetic-review-model'), { target: { value: 'updated-model' } });
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'updated-synthetic-secret' } });
    expect(save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ capabilityKey: 'review.summary', model: 'updated-model', apiKey: 'updated-synthetic-secret' }));
    fireEvent.click(screen.getByRole('button', { name: '重置' })); expect(reset).toHaveBeenCalledTimes(1); expect(screen.getByDisplayValue('synthetic-review-model')).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it('retains the Alpha fields, surfaces, error text and primary-modifier save shortcut', () => {
    const save = vi.fn();
    const ui = render(<AIRegistryOfferingFormView draft={initial} onDraftChange={vi.fn()} capabilityOptions={[]} vendorOptions={[]} error="Synthetic adapter error" onSave={save} onReset={vi.fn()}/>);
    const panel = ui.container.querySelector('section'); expect(panel).toHaveClass('rounded-xl', 'p-4', 'dark:bg-[#1C1917]', 'min-w-0');
    const secret = screen.getByPlaceholderText('sk-...'); expect(secret).toHaveAttribute('type', 'password'); expect(secret).toHaveClass('rounded-xl', 'dark:border-[#292524]'); expect(ui.container.textContent).not.toContain(initial.apiKey);
    expect(screen.getByText('Synthetic adapter error')).toBeInTheDocument();
    const notes = screen.getByPlaceholderText('记录质量、价格、额度、代理稳定性等备注');
    fireEvent.keyDown(notes, { key: 'Enter' }); expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(notes, { key: 'Enter', ctrlKey: true }); expect(save).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(notes, { key: 'Enter', ctrlKey: true, isComposing: true }); expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('combobox')).toHaveLength(4); expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
