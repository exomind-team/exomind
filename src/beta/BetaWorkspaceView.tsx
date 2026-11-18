import { type ReactNode } from 'react';
import { ChevronDown, EyeOff, Maximize2, NotebookPen, RefreshCw, RotateCcw, Search, Sparkles, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BetaPaneState, BetaWorkspaceLayout } from './workspace-layout';

export function BetaWorkspaceToolbar({ layout, onChange, hasFocus, tools }: {
  layout: BetaWorkspaceLayout; onChange: (patch: Partial<BetaWorkspaceLayout>) => void; hasFocus: boolean; tools?: ReactNode;
}) {
  return <div data-testid="beta-workspace-toolbar" className="flex min-h-11 shrink-0 items-center gap-1 border-b border-border-page px-3" aria-label="工作区视图">
    <Button size="icon" variant={layout.minimal ? 'secondary' : 'ghost'} aria-label="简洁记录" title="简洁记录" aria-pressed={!!layout.minimal} onClick={() => onChange({ minimal: !layout.minimal })}><Maximize2 size={16} aria-hidden="true"/></Button>
    {!layout.minimal && <>
    {hasFocus && <Button size="icon" variant={layout.focus === 'hidden' ? 'secondary' : 'ghost'} aria-label="隐藏专注" title="隐藏专注" aria-pressed={layout.focus === 'hidden'} onClick={() => onChange({ focus: layout.focus === 'hidden' ? 'expanded' : 'hidden' })}><Target size={16} aria-hidden="true" /></Button>}
    <Button size="icon" variant={layout.records === 'hidden' ? 'secondary' : 'ghost'} aria-label="隐藏记录" title="隐藏记录" aria-pressed={layout.records === 'hidden'} onClick={() => onChange({ records: layout.records === 'hidden' ? 'expanded' : 'hidden' })}><EyeOff size={16} aria-hidden="true" /></Button>
    {(layout.records !== 'expanded' || hasFocus && layout.focus !== 'expanded') && <Button size="icon" variant="ghost" aria-label="恢复默认视图" title="恢复默认视图" onClick={() => onChange({ focus: 'expanded', records: 'expanded' })}><RotateCcw size={15} aria-hidden="true"/></Button>}
    </>}
    <div className="ml-auto flex min-w-0 items-center gap-1">{tools}</div>
  </div>;
}

export function BetaHistoryToolbar({ onCollapse, onSearch, onRefresh, onReview, searchOpen }: {
  onCollapse: () => void; onSearch: () => void; onRefresh: () => void; onReview: () => void; searchOpen: boolean;
}) {
  return <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-page px-3" aria-label="记录工具">
    <Button size="sm" variant="ghost" aria-label="折叠记录" aria-expanded="true" onClick={onCollapse}><NotebookPen size={14} aria-hidden="true"/><span>记录</span><ChevronDown size={12} aria-hidden="true"/></Button>
    <div className="ml-auto flex items-center gap-1">
      <Button size="icon" variant={searchOpen ? 'secondary' : 'ghost'} aria-label="检索记录" title="检索记录" aria-pressed={searchOpen} onClick={onSearch}><Search size={15} aria-hidden="true"/></Button>
      <Button size="icon" variant="ghost" aria-label="刷新记录" title="刷新记录" onClick={onRefresh}><RefreshCw size={15} aria-hidden="true"/></Button>
      <Button size="icon" variant="ghost" aria-label="回顾" title="回顾" onClick={onReview}><Sparkles size={15} aria-hidden="true"/></Button>
    </div>
  </div>;
}

/** Keep children mounted: presentation changes must not replace the editor,
 * controller, selected text or reading window. Observation is gated separately. */
export function BetaWorkspacePane({ kind, state, onToggle, children, summary, chrome = true }: {
  kind: 'focus' | 'records'; state: BetaPaneState; onToggle: () => void; children: ReactNode; summary?: ReactNode; chrome?: boolean;
}) {
  const name = kind === 'focus' ? '专注' : '记录';
  const Icon = kind === 'focus' ? Target : NotebookPen;
  const expanded = state === 'expanded';
  return <section hidden={state === 'hidden'} aria-label={`${name}区`} className={state === 'hidden' ? 'hidden' : kind === 'records' && expanded ? 'flex min-h-[12rem] flex-1 flex-col' : 'shrink-0'}>
    {chrome && <div className="flex shrink-0 items-center gap-2 px-5 py-1">
      <button type="button" aria-label={`折叠${name}`} aria-expanded={expanded} aria-controls={`beta-${kind}-pane`} onClick={onToggle}
        className="flex min-h-9 items-center gap-2 rounded-md px-1 text-sm font-medium text-secondary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <Icon size={15} aria-hidden="true" /><span>{name}</span><ChevronDown size={14} aria-hidden="true" className={expanded ? '' : '-rotate-90'} />
      </button>
      {!expanded && <span className="min-w-0 truncate text-xs text-muted">{summary ?? '已折叠'}</span>}
    </div>}
    <div id={`beta-${kind}-pane`} hidden={!expanded} className={!expanded ? 'hidden' : kind === 'records' ? 'flex min-h-0 flex-1 flex-col' : ''}>{children}</div>
  </section>;
}
