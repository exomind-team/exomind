import { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface BetaShareHandoffItemView {
  id: string;
  name: string;
  mediaType: string;
  byteLength: number;
  state: 'receiving' | 'ready' | 'imported' | 'failed' | 'cancelled';
  message?: string;
}

export interface BetaShareHandoffCardProps {
  handoffId: string;
  profileName: string;
  text: string;
  textState: 'none' | 'receiving' | 'ready' | 'imported' | 'failed' | 'cancelled';
  items: readonly BetaShareHandoffItemView[];
  state: 'receiving' | 'cancelling' | 'ready' | 'importing' | 'failed' | 'cancelled';
  profileMismatch?: boolean;
  boundProfileName?: string;
  error?: string | null;
  onCancelReceive: () => void | Promise<void>;
  onAddToDraft: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onSwitchToBoundProfile?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
}

function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function itemStateLabel(state: BetaShareHandoffItemView['state']): string {
  switch (state) {
    case 'receiving': return '正在暂存';
    case 'ready': return '已校验';
    case 'imported': return '已加入草稿';
    case 'cancelled': return '接收已取消';
    case 'failed': return '暂存失败';
  }
}

/** A received Android share is a recoverable handoff. Importing it only changes
 * the editable local draft; the Capture remains behind the normal Send action. */
export function BetaShareHandoffCard({
  handoffId, profileName, text, textState, items, state, profileMismatch = false, boundProfileName, error,
  onCancelReceive, onAddToDraft, onDiscard, onSwitchToBoundProfile, onRefresh,
}: BetaShareHandoffCardProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const busy = state === 'importing' || state === 'cancelling';
  const canAdd = state === 'ready' || state === 'failed' || state === 'cancelled';
  const hasAddableContent = textState === 'ready' && text.length > 0 || items.some(item => item.state === 'ready');

  return <section
    aria-labelledby={`beta-share-title-${handoffId}`}
    className="mb-2 rounded-2xl border border-border-page bg-page px-3 py-3 shadow-sm dark:bg-page-dark"
    data-testid={`beta-share-handoff-${handoffId}`}
  >
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 id={`beta-share-title-${handoffId}`} className="text-xs font-semibold text-primary">
          {profileMismatch ? '系统分享属于其他档案' : state === 'cancelled' ? '系统分享接收已取消' : '系统分享已接收'}
        </h3>
        <p role="status" className="mt-1 text-[11px] text-secondary">
          {profileMismatch ? `分享内容已隐藏。请切换到「${boundProfileName || '归属'}」档案后继续处理。`
            : state === 'receiving' ? '正在安全暂存分享内容…'
            : state === 'cancelling' ? '正在停止本次接收…'
            : state === 'importing' ? `正在加入「${profileName}」草稿；尚未创建记录。`
              : state === 'cancelled' ? '系统已确认取消接收；已接收内容仍保留，未完成内容无法继续接收。'
              : state === 'failed' ? '分享内容尚未全部就绪；事件记录未创建。'
                : `内容已暂存在本机；加入「${profileName}」草稿后仍需手动发送。`}
        </p>
      </div>
      {(profileMismatch ? boundProfileName : profileName) && <span className="max-w-[45%] truncate rounded-full bg-muted px-2 py-1 text-[10px] text-secondary" title={profileMismatch ? boundProfileName : profileName}>
        {profileMismatch ? '归属档案 · ' : '目标档案 · '}{profileMismatch ? boundProfileName : profileName}
      </span>}
    </div>

    {profileMismatch
      ? <div className="mt-2 rounded-xl border border-border-page bg-muted/40 px-3 py-2 text-[11px] text-secondary">
        当前档案无法查看分享文字或附件。切换到归属档案后，内容才会显示。
      </div>
      : !!text && <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2 dark:bg-muted/30">
      <p className="mb-1 text-[10px] text-muted">分享文字 · {textState === 'ready' ? '已暂存' : textState === 'imported' ? '已加入草稿' : textState === 'receiving' ? '正在接收' : textState === 'cancelled' ? '接收已取消' : textState === 'none' ? '无文字内容' : '暂存失败'}</p>
      <p className="max-h-16 overflow-hidden whitespace-pre-wrap break-words text-xs text-primary" data-testid={`beta-share-text-${handoffId}`}>
        {text.length > 400 ? `${text.slice(0, 400)}…` : text}
      </p>
    </div>}

    {!profileMismatch && items.length > 0 && <ul aria-label="分享附件" className="mt-2 space-y-1">
      {items.map(item => <li key={item.id} className="flex min-w-0 items-start gap-2 text-[11px]">
        <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-primary" title={item.name}>{item.name}</span>
          <span className="text-muted">{formatBytes(item.byteLength)} · {item.mediaType || '类型未知'} · {itemStateLabel(item.state)}</span>
          {item.message && <span className="block text-destructive">{item.message}</span>}
        </span>
      </li>)}
    </ul>}

    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

    {profileMismatch
      ? <div className="mt-3 flex flex-wrap items-center gap-2">
        {onSwitchToBoundProfile && <Button type="button" size="sm" disabled={busy} onClick={() => { void onSwitchToBoundProfile(); }}>
          切换到「{boundProfileName || '归属'}」档案
        </Button>}
        {!onSwitchToBoundProfile && onRefresh && <Button type="button" size="sm" variant="outline" onClick={() => { void onRefresh(); }}>重新读取归属</Button>}
      </div>
      : confirmDiscard
      ? <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-2" role="group" aria-label="确认放弃系统分享">
        <p className="text-xs text-primary">放弃后会移除这份本机分享暂存，且不会创建事件记录。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirmDiscard(false)}>继续保留</Button>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => { void onDiscard(); }}>确认放弃</Button>
        </div>
      </div>
      : <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === 'receiving' && <Button type="button" size="sm" variant="outline" onClick={() => { void onCancelReceive(); }}>取消接收</Button>}
        {((canAdd && hasAddableContent) || state === 'importing') && <Button type="button" size="sm" disabled={busy || !profileName} onClick={() => { void onAddToDraft(); }}>
          {state === 'importing' ? '正在加入草稿…' : `添加到「${profileName || '当前档案'}」草稿`}
        </Button>}
        {state !== 'receiving' && state !== 'cancelling' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDiscard(true)}>放弃本次分享…</Button>}
      </div>}
  </section>;
}
