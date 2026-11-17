import { type ReactNode } from 'react';
import { ChevronDown, EyeOff, LayoutPanelTop, NotebookPen, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BetaPaneState, BetaWorkspaceLayout } from './workspace-layout';

export function BetaWorkspaceToolbar({ layout, onChange, hasFocus }: {
  layout: BetaWorkspaceLayout; onChange: (patch: Partial<BetaWorkspaceLayout>) => void; hasFocus: boolean;
}) {
  return <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-page px-5 py-2" aria-label="工作区视图">
    <LayoutPanelTop size={15} className="mr-1 text-muted" aria-hidden="true" />
    {hasFocus && <Button size="sm" variant={layout.focus === 'hidden' ? 'secondary' : 'ghost'} aria-pressed={layout.focus === 'hidden'} onClick={() => onChange({ focus: layout.focus === 'hidden' ? 'expanded' : 'hidden' })}><EyeOff size={14} className="mr-1.5" aria-hidden="true" />隐藏专注</Button>}
    <Button size="sm" variant={layout.records === 'hidden' ? 'secondary' : 'ghost'} aria-pressed={layout.records === 'hidden'} onClick={() => onChange({ records: layout.records === 'hidden' ? 'expanded' : 'hidden' })}><EyeOff size={14} className="mr-1.5" aria-hidden="true" />隐藏记录</Button>
    {(layout.records !== 'expanded' || hasFocus && layout.focus !== 'expanded') && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onChange({ focus: 'expanded', records: 'expanded' })}>恢复默认视图</Button>}
  </div>;
}

/** Keep children mounted: presentation changes must not replace the editor,
 * controller, selected text or reading window. Observation is gated separately. */
export function BetaWorkspacePane({ kind, state, onToggle, children, summary }: {
  kind: 'focus' | 'records'; state: BetaPaneState; onToggle: () => void; children: ReactNode; summary?: ReactNode;
}) {
  const name = kind === 'focus' ? '专注' : '记录';
  const Icon = kind === 'focus' ? Target : NotebookPen;
  const expanded = state === 'expanded';
  return <section hidden={state === 'hidden'} aria-label={`${name}区`} className={state === 'hidden' ? 'hidden' : kind === 'records' && expanded ? 'flex min-h-[12rem] flex-1 flex-col' : 'shrink-0'}>
    <div className="flex shrink-0 items-center gap-2 px-5 py-1">
      <button type="button" aria-label={`折叠${name}`} aria-expanded={expanded} aria-controls={`beta-${kind}-pane`} onClick={onToggle}
        className="flex min-h-9 items-center gap-2 rounded-md px-1 text-sm font-medium text-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <Icon size={15} aria-hidden="true" /><span>{name}</span><ChevronDown size={14} aria-hidden="true" className={expanded ? '' : '-rotate-90'} />
      </button>
      {!expanded && <span className="min-w-0 truncate text-xs text-muted">{summary ?? '已折叠'}</span>}
    </div>
    <div id={`beta-${kind}-pane`} hidden={!expanded} className={!expanded ? 'hidden' : kind === 'records' ? 'flex min-h-0 flex-1 flex-col' : ''}>{children}</div>
  </section>;
}
