import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BetaClient } from './client';
import type { BetaOriginal } from './original-types';
import type { SummarySelection } from './summary-types';
import { parseSummaryModelConfiguration, type SummaryModelConfiguration } from './summary-model-config';

const MAX_BYTES = 256 * 1024;
const MAX_ORIGINALS = 256;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export type SummaryOriginalChoice = {
  ids: string[];
  consent: { provider_config_revision: string; max_original_bytes: number } | null;
};
export const emptyOriginalChoice = (): SummaryOriginalChoice => ({ ids: [], consent: null });
export function summaryOriginalScope(profileId: string, selection: SummarySelection): string {
  return JSON.stringify([profileId, selection.block_ids, selection.from_ms, selection.to_ms]);
}

function Choice({ checked, disabled, onChange, children }: {
  checked: boolean; disabled?: boolean; onChange: () => void; children: ReactNode;
}) {
  return <Button type="button" role="checkbox" aria-checked={checked} disabled={disabled}
    variant="ghost" className="h-auto w-full justify-start whitespace-normal py-2 text-left" onClick={onChange}>
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded border border-input text-primary">{checked && <Check size={12}/>}</span>
    <span className="min-w-0 break-words">{children}</span>
  </Button>;
}

/** Lists reference metadata only. The Host owns byte reads and dispatch qualification. */
export function SummaryOriginalSelection({ client, profileId, selection, retainedIds, disabled, onChange }: {
  client: BetaClient; profileId: string; selection: SummarySelection; disabled: boolean;
  retainedIds?: readonly string[];
  onChange: (choice: SummaryOriginalChoice) => void;
}) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [items, setItems] = useState<BetaOriginal[]>([]), [ids, setIds] = useState<string[]>([]);
  const [provider, setProvider] = useState<SummaryModelConfiguration | null>(null), [approved, setApproved] = useState(false);
  const [cursor, setCursor] = useState<{ through: number; before: number | null } | null>(null);
  const scope = summaryOriginalScope(profileId, selection) + JSON.stringify(retainedIds ?? null);
  const required = retainedIds ? new Set(retainedIds) : null;
  const binding = useMemo(() => ({ client, scope }), [client, scope]);
  const current = useRef(binding); current.current = binding;
  const life = useRef({ active: false, binding }), busy = useRef(false), changed = useRef(onChange); changed.current = onChange;
  const isCurrent = (owner: typeof life.current) => owner.active && owner.binding === current.current;
  useEffect(() => {
    const owner = { active: true, binding }; life.current = owner; busy.current = false;
    setOpen(false); setLoading(false); setError(''); setItems([]); setIds([]); setApproved(false); setProvider(null); setCursor(null);
    changed.current(emptyOriginalChoice());
    return () => { owner.active = false; };
  }, [binding]);
  const selected = items.filter(item => ids.includes(item.original_id));
  const total = selected.reduce((sum, item) => sum + item.byte_length, 0);
  function publish(nextIds: string[], consent: SummaryOriginalChoice['consent'] = null) {
    setIds(nextIds); setApproved(consent !== null); changed.current({ ids: nextIds, consent });
  }
  async function load(reset = false) {
    if (busy.current || !isCurrent(life.current) || !client.timelinePeriodPage || !client.summaryModel) return;
    const owner = life.current; busy.current = true; setLoading(true); setError('');
    if (reset) { publish([]); setItems([]); setCursor(null); setProvider(null); }
    try {
      const status = await client.status();
      if (!isCurrent(owner)) return;
      if (status.capabilities?.summary_originals !== true) {
        publish([]); setError('当前服务尚未提供原件外发确认能力，请更新后重试。'); return;
      }
      const configuration = parseSummaryModelConfiguration(await client.summaryModel.read(profileId), profileId);
      if (!isCurrent(owner)) return;
      if (!configuration.enabled || !configuration.revision) throw Error('Provider not ready');
      const current = reset ? null : cursor;
      const page = await client.timelinePeriodPage(profileId, {
        from_ms: selection.from_ms, to_ms: selection.to_ms, limit: 100,
        ...(current ? { through: current.through, ...(current.before !== null ? { before: current.before } : {}) } : {}),
      });
      if (!isCurrent(owner)) return;
      const originals = new Map((reset ? [] : items).map(item => [item.original_id, item]));
      for (const entry of page.items) {
        if (entry.record.profile_id !== profileId) throw Error('Wrong profile');
        if (entry.kind !== 'capture') continue;
        for (const original of entry.record.originals ?? []) {
          if (required && !required.has(original.original_id)) continue;
          const previous = originals.get(original.original_id);
          if (previous && (previous.sha256 !== original.sha256 || previous.byte_length !== original.byte_length
            || previous.media_type !== original.media_type || previous.file_name !== original.file_name)) throw Error('Reference changed');
          originals.set(original.original_id, original);
          if (originals.size > MAX_ORIGINALS) throw Error('Too many original references');
        }
      }
      if (provider && provider.revision !== configuration.revision) publish([]);
      if (retainedIds) {
        const retained = retainedIds.map(id => originals.get(id));
        if (retained.every((item): item is BetaOriginal => item !== undefined)) {
          const bytes = retained.reduce((sum, item) => sum + item.byte_length, 0);
          if (bytes <= 0 || bytes > MAX_BYTES || retained.some(item => item.byte_length <= 0 || !IMAGE_TYPES.has(item.media_type))) throw Error('Retained originals unsupported');
          publish([...retainedIds]);
        } else publish([]);
      }
      setProvider(configuration); setItems([...originals.values()]);
      setCursor({ through: page.highwater, before: page.next_before });
    } catch {
      if (isCurrent(owner)) { publish([]); setError('原件或模型信息尚未确认，请重新核对；范围较大时可缩小范围。'); }
    } finally { if (isCurrent(owner)) { busy.current = false; setLoading(false); } }
  }
  function toggle(original: BetaOriginal) {
    publish(ids.includes(original.original_id) ? ids.filter(id => id !== original.original_id) : [...ids, original.original_id]);
  }
  return <section className="space-y-3 rounded-xl border border-border-subtle p-3" aria-label="给模型的原件">
    <Button type="button" variant="outline" size="sm" disabled={disabled || loading} aria-expanded={open} onClick={() => {
      if (open) { setOpen(false); publish([]); } else { setOpen(true); void load(true); }
    }}>{retainedIds ? '核对本轮外发原件' : '选择给模型的原件'}</Button>
    {open && <div className="space-y-3 text-sm">
      <p className="text-xs text-secondary">{retainedIds ? '本轮沿用任务此前明确选择的原件；请核对文件与模型，重新确认本次外发。' : '文字按原范围处理。这里仅列文件信息；原件默认不选，外发另需明确同意。'}</p>
      {provider && <div className="space-y-1 break-all text-xs"><p>发送目标：{new URL(provider.base_url).origin}</p><p>模型：{provider.model}</p></div>}
      {items.map(original => {
        const checked = ids.includes(original.original_id), supported = IMAGE_TYPES.has(original.media_type);
        const tooLarge = original.byte_length <= 0 || original.byte_length > MAX_BYTES || !checked && total + original.byte_length > MAX_BYTES;
        return <div key={original.original_id}>{retainedIds ? <p className="break-all px-3 py-2">{original.file_name} · {original.byte_length} B</p> : <Choice checked={checked} disabled={disabled || loading || !supported || tooLarge} onChange={() => toggle(original)}>
          {original.file_name} · {original.byte_length} B
        </Choice>}{!supported && <p className="px-3 text-xs text-muted">此格式暂不支持提供给模型，仍保留原件。</p>}{tooLarge && <p className="px-3 text-xs text-muted">超出本次原件上限或文件为空。</p>}</div>;
      })}
      {loading && <p role="status" className="text-xs text-muted">正在读取文件信息与模型配置…</p>}
      {cursor?.before !== null && cursor && <Button type="button" variant="outline" size="sm" disabled={disabled || loading} onClick={() => void load()}>继续读取原件信息（100条记录）</Button>}
      {cursor && !items.length && <p className="text-xs text-muted">已读取页中没有可选原件。</p>}
      {retainedIds && cursor && ids.length !== retainedIds.length && <p className="text-xs text-muted">本轮原件信息尚未齐全，请继续读取或先补齐来源；外发确认尚未启用。</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button type="button" variant="ghost" size="sm" disabled={disabled || loading} onClick={() => void load(true)}>重新核对原件与模型</Button>
      {!!ids.length && provider?.revision && <>
        <p className="text-xs text-secondary">已选 {ids.length} 件，共 {total} B；本次批准上限 {total} B（最多 256 KiB）。读取权限与外发同意分别核对。</p>
        <Choice checked={approved} disabled={disabled || loading || !!error} onChange={() => publish(ids, approved ? null : { provider_config_revision: provider.revision!, max_original_bytes: total })}>
          我同意将所选原件发送给上述模型
        </Choice>
      </>}
    </div>}
  </section>;
}
