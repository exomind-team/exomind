import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { ChevronDown, Hash, LoaderCircle, PencilLine, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { BetaApiError, type BetaClient, type BetaEvent } from './client';
import {
  betaCorrectionTextByteLength,
  betaCorrectionTextIssue,
  MAX_BETA_EVENT_TAG_BYTES, MAX_BETA_EVENT_TAGS,
  MAX_BETA_CORRECTION_TEXT_BYTES,
  type BetaCorrectionEntry, type BetaRecordCorrectionCommand,
} from './record-organization-client';
import { BetaRecordCorrectionOwner, type BetaCorrectionOwnerSnapshot } from './record-correction-owner';

export function BetaCaptureTagsEditor({ tags, onChange }: {
  tags: readonly string[];
  onChange: (tags: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();
  const helpId = useId();

  function addTag(): void {
    const tag = value.trim();
    if (!tag) { setError('请输入标签内容'); return; }
    if (new TextEncoder().encode(tag).byteLength > MAX_BETA_EVENT_TAG_BYTES) {
      setError('单个标签最多 128 字节');
      return;
    }
    if (tags.includes(tag)) { setValue(''); setError(''); return; }
    if (tags.length >= MAX_BETA_EVENT_TAGS) { setError('一条记录最多添加 64 个标签'); return; }
    try {
      onChange([...tags, tag]);
      setValue('');
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '标签暂时无法保存');
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      addTag();
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-1 pb-2" data-testid="beta-capture-tags">
      <Button
        type="button" size="sm" variant="ghost" className="min-h-8 px-2 text-xs"
        aria-expanded={open} aria-controls={helpId} aria-label={`编辑记录标签${tags.length ? `，${tags.length} 个` : ''}`}
        onClick={() => { setOpen(current => !current); setError(''); }}
      >
        <Hash size={14} aria-hidden="true" />
        <span>标签{tags.length ? ` · ${tags.length}` : ''}</span>
        <ChevronDown size={13} aria-hidden="true" className={open ? 'rotate-180' : ''} />
      </Button>
      {open && (
        <div id={helpId} className="basis-full space-y-2 rounded-lg border border-border-subtle bg-card p-2">
          <div className="flex min-w-0 gap-2">
            <label className="sr-only" htmlFor={inputId}>添加记录标签</label>
            <Input
              id={inputId} aria-describedby={error ? `${helpId}-error` : undefined}
              aria-invalid={!!error} value={value} onChange={event => { setValue(event.target.value); setError(''); }}
              onKeyDown={onInputKeyDown} placeholder="添加标签" autoComplete="off"
            />
            <Button type="button" variant="outline" size="sm" onClick={addTag} disabled={!value.trim()}>添加</Button>
          </div>
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="当前记录标签">
              {tags.map(tag => (
                <li key={tag}>
                  <Badge variant="secondary" className="gap-1 pr-1">
                    <span className="max-w-48 truncate">{tag}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6 min-h-6"
                      aria-label={`移除标签 ${tag}`} onClick={() => onChange(tags.filter(item => item !== tag))}>
                      <X size={12} aria-hidden="true" />
                    </Button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {error && <p id={`${helpId}-error`} className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function BetaRecordTagFilter({ value, activeTag, onValueChange, onApply, onClear }: {
  value: string;
  activeTag: string;
  onValueChange: (value: string) => void;
  onApply: (tag: string) => void;
  onClear: () => void;
}) {
  const [error, setError] = useState('');
  const inputId = useId();

  function apply(): void {
    const tag = value.trim();
    if (!tag) { setError('请输入要筛选的标签'); return; }
    if (new TextEncoder().encode(tag).byteLength > MAX_BETA_EVENT_TAG_BYTES) {
      setError('单个标签最多 128 字节');
      return;
    }
    setError('');
    onApply(tag);
  }

  return (
    <div className="min-w-0 space-y-1.5" data-testid="beta-record-tag-filter">
      <div className="flex min-w-0 gap-2">
        <label htmlFor={inputId} className="sr-only">按标签筛选记录</label>
        <Input id={inputId} value={value} onChange={event => { onValueChange(event.target.value); setError(''); }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault(); event.stopPropagation(); apply();
            }
          }} placeholder="输入完整标签" aria-invalid={!!error} />
        <Button type="button" size="sm" variant="outline" onClick={apply} disabled={!value.trim()}>按标签筛选</Button>
        {activeTag && <Button type="button" size="sm" variant="ghost" onClick={() => { setError(''); onClear(); }}>清除标签</Button>}
      </div>
      {activeTag && <p className="text-xs text-secondary" role="status">正在按“{activeTag}”筛选；这里仅显示记录，不含时间块和回顾。</p>}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

const EMPTY_CORRECTION_OWNER_SNAPSHOT: BetaCorrectionOwnerSnapshot = { entries: [] };
const emptyOwnerSnapshot = (): BetaCorrectionOwnerSnapshot => EMPTY_CORRECTION_OWNER_SNAPSHOT;
const noOwnerSubscription = () => () => {};

function correctionTargetKey(profileId: string, eventId: string): string {
  return profileId + '\u0000' + eventId;
}

export function BetaRecordCorrectionDialog({
  open, target, profileId, client, highwater, now, dateMode, owner, ownerError, onOpenChange, onChanged,
}: {
  open: boolean;
  target: BetaEvent | null;
  profileId: string;
  client: BetaClient;
  highwater?: number;
  now: number;
  dateMode: EventDateDisplayMode;
  owner: BetaRecordCorrectionOwner | null;
  ownerError: string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const ownerSnapshot = useSyncExternalStore(
    owner?.subscribe ?? noOwnerSubscription,
    owner?.snapshot ?? emptyOwnerSnapshot,
    emptyOwnerSnapshot,
  );
  const targetEntries = target
    ? ownerSnapshot.entries.filter(entry => entry.command.profile_id === profileId && entry.command.target_event_id === target.event_id)
    : [];
  const pending = targetEntries.find(entry => entry.status === 'pending');
  const sending = targetEntries.find(entry => entry.status === 'sending');
  const savingIntent = targetEntries.find(entry => entry.status === 'saving');
  const saveFailed = targetEntries.find(entry => entry.status === 'save_failed');
  const acceptedEntries = targetEntries.filter(entry => entry.status === 'accepted');
  const currentRecovery = sending ?? pending ?? savingIntent ?? saveFailed ?? acceptedEntries[0];
  const [entries, setEntries] = useState<BetaCorrectionEntry[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [pageHighwater, setPageHighwater] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recoveryRetrying, setRecoveryRetrying] = useState(false);
  const [recoveryActionMessage, setRecoveryActionMessage] = useState('');
  const [correctedText, setCorrectedText] = useState('');
  const [requestFailure, setRequestFailure] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  const readScope = useRef<{ client: BetaClient; profileId: string; eventId: string } | null>(null);
  const editScope = useRef<string | null>(null);
  const scope = useRef({ open, profileId, eventId: target?.event_id, client, highwater });
  scope.current = { open, profileId, eventId: target?.event_id, client, highwater };
  const textHelpId = useId();
  const textBytes = betaCorrectionTextByteLength(correctedText);
  const textIssue = betaCorrectionTextIssue(correctedText);

  useEffect(() => {
    const current = ++sequence.current;
    if (!open || !target || !client.recordOrganization) {
      readScope.current = null;
      return () => { ++sequence.current; };
    }
    const previous = readScope.current;
    if (previous?.client === client && previous.profileId === profileId && previous.eventId === target.event_id) {
      return () => { ++sequence.current; };
    }
    readScope.current = { client, profileId, eventId: target.event_id };
    setEntries([]); setBefore(null); setPageHighwater(undefined); setError(''); setNotice('');
    const nextEditScope = correctionTargetKey(profileId, target.event_id);
    if (editScope.current !== nextEditScope) {
      editScope.current = nextEditScope;
      setCorrectedText('');
    }
    setLoading(true);
    const startHighwater = scope.current.highwater;
    void client.recordOrganization.correctionsForTarget(profileId, target.event_id, {
      limit: 100,
      ...(startHighwater === undefined ? {} : { through: startHighwater }),
    }).then(page => {
      if (sequence.current !== current) return;
      setEntries(mergeCorrectionEntries([], page.items)); setBefore(page.next_before); setPageHighwater(page.highwater);
    }).catch(failure => {
      if (sequence.current === current) setError(errorMessageForCorrections(failure));
    }).finally(() => {
      if (sequence.current === current) setLoading(false);
    });
    return () => { ++sequence.current; };
  }, [open, profileId, target?.event_id, client]);

  useEffect(() => {
    if (!open || !target || correctedText || !currentRecovery
      || (currentRecovery.status !== 'pending' && currentRecovery.status !== 'save_failed')) return;
    setCorrectedText(currentRecovery.command.corrected_text);
  }, [open, profileId, target?.event_id, correctedText, currentRecovery?.command.command_id, currentRecovery?.status]);

  const currentCorrection = latestMatchingCorrection(entries);
  const conflicting = entries.some(entry => entry.target_state === 'digest_conflict');
  const recoveryReadError = ownerSnapshot.error || '';
  const targetIsBlocked = !!pending || !!sending || !!savingIntent || !!saveFailed;

  async function loadOlder(): Promise<void> {
    if (!target || !client.recordOrganization || before === null || loading || pageHighwater === undefined) return;
    const current = sequence.current;
    setLoading(true); setError('');
    try {
      const page = await client.recordOrganization.correctionsForTarget(profileId, target.event_id, {
        before, through: pageHighwater, limit: 100,
      });
      if (sequence.current !== current) return;
      setEntries(previous => mergeCorrectionEntries(previous, page.items));
      setBefore(page.next_before);
    } catch (failure) {
      if (sequence.current === current) setError(errorMessageForCorrections(failure));
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  }

  function stillCurrent(current: number, command: Readonly<BetaRecordCorrectionCommand>): boolean {
    return sequence.current === current && scope.current.open
      && scope.current.profileId === command.profile_id && scope.current.eventId === command.target_event_id
      && scope.current.client === client;
  }

  async function refreshAfterReceipt(command: Readonly<BetaRecordCorrectionCommand>, current: number): Promise<void> {
    if (!stillCurrent(current, command)) return;
    setNotice('更正已记录，原始记录仍保留。');
    onChanged();
    if (!client.recordOrganization) return;
    try {
      const page = await client.recordOrganization.correctionsForTarget(command.profile_id, command.target_event_id, { limit: 100 });
      if (!stillCurrent(current, command)) return;
      setEntries(mergeCorrectionEntries([], page.items)); setBefore(page.next_before); setPageHighwater(page.highwater); setError('');
    } catch (failure) {
      if (stillCurrent(current, command)) setError('更正已记录，但暂时无法读取更正记录：' + errorMessageForCorrections(failure));
    }
  }

  async function submitCorrection(retry: boolean): Promise<void> {
    if (!target || !owner || !client.recordOrganization || saving || ownerError || (!retry && recoveryReadError)) return;
    if (!retry && textIssue === 'empty') { setError('请先写下非空更正内容'); return; }
    if (!retry && textIssue === 'invalid_unicode') { setError('更正内容包含无法传输的 Unicode 字符，请重新输入该字符'); return; }
    if (!retry && textIssue === 'too_large') { setError('更正内容超过 128 KiB UTF-8 字节上限，请删减后再保存'); return; }
    if (!retry && !/^[a-f0-9]{64}$/.test(target.digest)) { setError('原始记录没有可验证的摘要，不能提交更正'); return; }
    const current = sequence.current;
    setSaving(true); setError(''); setRequestFailure(''); setNotice('');
    try {
      const result = retry
        ? await owner.retry(client, profileId, target.event_id)
        : await owner.submit(client, target, correctedText);
      if (!stillCurrent(current, result.command)) return;
      if (result.status === 'save_failed') {
        setRequestFailure('本机恢复 journal 未确认保存；本次更正尚未发送。请重试本机暂存或取消这份未提交更正。');
        return;
      }
      if (result.status === 'pending') return;
      if (result.status === 'accepted') {
        if (correctedText === result.command.corrected_text) setCorrectedText('');
        await refreshAfterReceipt(result.command, current);
      }
    } catch (failure) {
      if (sequence.current === current && scope.current.open) {
        const detail = errorMessageForCorrections(failure);
        if (failure instanceof BetaApiError && failure.code === 'invalid_correction') {
          setRequestFailure(`本机更正校验拒绝了请求；本次更正尚未保存或发送。${detail}`);
        } else if (failure instanceof BetaApiError && failure.code === 'invalid_request') {
          setRequestFailure(`更正请求被明确拒绝；没有收到成功回执。错误没有指出具体字段。${detail} 输入仍保留，可修改后重试。`);
        } else if (failure instanceof BetaApiError && failure.status >= 400 && failure.status < 500
          && ![408, 425, 429].includes(failure.status)) {
          setRequestFailure(`服务响应明确拒绝了更正；服务没有接受本次更正。${detail} 输入仍保留，可修改后重试。`);
        } else {
          setError(detail);
        }
      }
    } finally {
      if (sequence.current === current && scope.current.open) setSaving(false);
    }
  }

  async function retryAcceptedCleanup(command: Readonly<BetaRecordCorrectionCommand>): Promise<void> {
    if (!owner || saving) return;
    const current = sequence.current;
    setSaving(true); setError('');
    try {
      await owner.retryCleanup(command.profile_id, command.target_event_id);
      if (sequence.current === current && scope.current.open) {
        setNotice('更正已记录；本机恢复记录清理已重试。');
        onChanged();
      }
    } catch (failure) {
      if (sequence.current === current && scope.current.open) setError(errorMessageForCorrections(failure));
    } finally {
      if (sequence.current === current && scope.current.open) setSaving(false);
    }
  }

  async function copyCorrectionText(): Promise<void> {
    if (!correctedText.trim()) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持剪贴板写入');
      await navigator.clipboard.writeText(correctedText);
      setNotice('更正文本已复制；弹层中的输入仍保留。');
      setRecoveryActionMessage('');
    } catch (failure) {
      setRecoveryActionMessage(`无法自动复制；当前输入仍保留在弹层中，请手动复制。${errorMessageForCorrections(failure)}`);
    }
  }

  async function retryRecovery(): Promise<void> {
    if (recoveryRetrying) return;
    setRecoveryRetrying(true);
    setRecoveryActionMessage('');
    try {
      if (owner) {
        await owner.retryRecovery();
        setNotice('已重试读取本机恢复 journal；当前输入仍保留。');
        return;
      }
      if (correctedText.trim() && !window.confirm('刷新会关闭弹层并清空当前输入。请先复制更正文本；确认后刷新并重试本机恢复？')) {
        return;
      }
      window.location.reload();
    } catch (failure) {
      setRecoveryActionMessage(`本机恢复仍不可用；未刷新页面，本次更正尚未发送，当前输入仍保留。${errorMessageForCorrections(failure)}`);
    } finally {
      setRecoveryRetrying(false);
    }
  }

  const textId = useId();
  return (
    <Dialog open={open} onOpenChange={next => {
      if (!next) ++sequence.current;
      onOpenChange(next);
    }}>
      {open && target && (
        <DialogContent className="max-h-[88dvh] overflow-y-auto border-border-card bg-card text-card-foreground">
          <DialogHeader>
            <DialogTitle>查看或更正记录</DialogTitle>
            <DialogDescription>更正会作为一条新记录保存，原始内容与来源保持不变。关闭弹层不会取消已提交的更正。</DialogDescription>
          </DialogHeader>
          <section className="space-y-2 rounded-lg border border-border-subtle bg-page dark:bg-page-dark p-3" aria-label="原始记录">
            <div className="flex items-center gap-2 text-xs text-secondary"><h3 className="font-semibold">原始记录</h3><EventTimestamp timestamp={target.occurred_at_ms} now={now} mode={dateMode}/></div>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground selection:bg-active/40 selection:text-foreground">{target.text}</p>
            <p className="text-[11px] text-muted">原记录仍可通过记录历史和引用回看。</p>
          </section>
          <section className="space-y-2" aria-label="已有更正">
            <h3 className="text-sm font-medium text-strong">已有更正</h3>
            {currentCorrection ? (
              <div className="space-y-1 rounded-lg border border-border-subtle bg-card px-3 py-2" data-testid="beta-current-correction">
                <Badge variant="secondary">最新更正</Badge>
                <EventTimestamp timestamp={currentCorrection.record.occurred_at_ms} now={now} mode={dateMode}/>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{currentCorrection.record.corrected_text}</p>
              </div>
            ) : loading && entries.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-muted" role="status"><LoaderCircle size={14} className="animate-spin" />正在读取</p>
            ) : entries.length === 0 && !error ? (
              <p className="text-xs text-muted">还没有更正记录。</p>
            ) : null}
            {conflicting && <p className="text-xs text-destructive" role="alert">有更正引用的原记录摘要与当前内容冲突；这些更正不会冒充已应用。</p>}
            {entries.filter(entry => entry.target_state !== 'digest_matches').map(entry => (
              <div key={entry.record.event_id} className="rounded-lg border border-border-subtle px-3 py-2">
                <p className="text-[11px] font-medium text-secondary">{entry.target_state === 'unresolved' ? '原记录暂未找到' : '原记录摘要不匹配'}</p>
                <EventTimestamp timestamp={entry.record.occurred_at_ms} now={now} mode={dateMode}/>
                <p className="whitespace-pre-wrap break-words text-sm text-secondary">{entry.record.corrected_text}</p>
              </div>
            ))}
            {entries.length > 1 && entries.filter(entry => entry.target_state === 'digest_matches').slice(1).map(entry => (
              <div key={entry.record.event_id} className="rounded-lg border border-border-subtle px-3 py-2">
                <p className="text-[11px] text-muted">较早更正</p>
                <EventTimestamp timestamp={entry.record.occurred_at_ms} now={now} mode={dateMode}/>
                <p className="whitespace-pre-wrap break-words text-sm text-secondary">{entry.record.corrected_text}</p>
              </div>
            ))}
            {before !== null && <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void loadOlder()}>加载更早更正</Button>}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </section>
          <div className="space-y-2">
            <label className="text-sm font-medium text-strong" htmlFor={textId}>写下更正内容</label>
            <Textarea id={textId} value={correctedText} onChange={event => { setCorrectedText(event.target.value); setError(''); setRequestFailure(''); setRecoveryActionMessage(''); }}
              placeholder="补充准确表述" rows={4} aria-required="true" aria-describedby={textHelpId}
              aria-invalid={textIssue === 'invalid_unicode' || textIssue === 'too_large'} disabled={saving || targetIsBlocked} />
            <p id={textHelpId} className={`text-xs ${textIssue === 'too_large' || textIssue === 'invalid_unicode' ? 'text-destructive' : 'text-muted'}`}
              role={textIssue === 'too_large' || textIssue === 'invalid_unicode' ? 'alert' : 'note'}>
              {textIssue === 'empty' ? '请输入非空更正内容。'
                : textIssue === 'invalid_unicode' ? '更正内容包含无法传输的 Unicode 字符，请重新输入该字符。'
                  : textIssue === 'too_large' ? '更正内容超过上限；请删减至 128 KiB UTF-8 字节以内。'
                    : '普通 Markdown 与换行会按原文保存，不解析引用或代码块。'}{' '}
              <span>{textBytes.toLocaleString('zh-CN')} / {MAX_BETA_CORRECTION_TEXT_BYTES.toLocaleString('zh-CN')} UTF-8 字节</span>
            </p>
            {currentRecovery?.status === 'pending' && <p className="text-xs text-secondary" role="status">{currentRecovery.message ?? '命令已持久保存，提交结果尚未确认；查证会复用同一命令和正文。'}</p>}
            {currentRecovery?.status === 'sending' && <p className="text-xs text-secondary" role="status">{currentRecovery.message ?? '本机命令已持久保存；正在发送更正请求，尚未收到服务回执。'}</p>}
            {currentRecovery?.status === 'saving' && <p className="text-xs text-secondary" role="status">正在保存恢复命令；确认本机暂存后才会发送。</p>}
            {currentRecovery?.status === 'save_failed' && <p className="text-xs text-destructive" role="alert">恢复命令尚未持久保存，因此没有发送更正。{currentRecovery.message ? ` ${currentRecovery.message}` : ''}</p>}
            {requestFailure && <p className="text-xs text-destructive" role="alert">{requestFailure}</p>}
            {acceptedEntries.map(entry => (
              <div key={entry.command.command_id} className="space-y-1">
                <p className="text-xs text-secondary" role="status">{entry.message ?? '更正已记录，原始记录仍保留。'}</p>
                <Button type="button" size="sm" variant="ghost" disabled={saving || !owner}
                  onClick={() => void retryAcceptedCleanup(entry.command)}>重试清理本机恢复记录</Button>
              </div>
            ))}
            {!owner && !ownerError && <p className="text-xs text-secondary" role="status">正在恢复本机更正记录；恢复完成前不会发送新更正。</p>}
            {ownerError && <p className="text-xs text-destructive" role="alert">本机更正恢复初始化失败，无法保存恢复命令；本次更正未发送：{ownerError}</p>}
            {recoveryReadError && <p className="text-xs text-destructive" role="alert">本机恢复状态读取未确认；新更正暂不可保存。已有命令可能已发送，发送结果仍待查证：{recoveryReadError}</p>}
            {(ownerError || recoveryReadError || requestFailure) && <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={recoveryRetrying} onClick={() => void retryRecovery()}>
                {recoveryRetrying ? '正在重试恢复' : owner ? '重试读取本机恢复' : '刷新并重试恢复'}
              </Button>
              {correctedText.trim() && <Button type="button" size="sm" variant="ghost" onClick={() => void copyCorrectionText()}>复制更正文本</Button>}
            </div>}
            {recoveryActionMessage && <p className="text-xs text-destructive" role="alert">{recoveryActionMessage}</p>}
            {notice && <p className="text-xs text-secondary" role="status">{notice}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
            {saveFailed && owner && (
              <Button type="button" variant="ghost" disabled={saving} onClick={() => {
                const current = sequence.current;
                setSaving(true);
                void owner.cancelUnsubmitted(profileId, target.event_id).then(cancelled => {
                  if (sequence.current !== current || !scope.current.open) return;
                  if (cancelled) {
                    setCorrectedText(''); setError(''); setNotice('未提交的更正编辑已取消；没有发送命令。');
                  } else {
                    setError('取消尚未确认；本机恢复记录仍然保留，请重试。');
                  }
                }).catch(failure => {
                  if (sequence.current === current && scope.current.open) setError(errorMessageForCorrections(failure));
                }).finally(() => {
                  if (sequence.current === current && scope.current.open) setSaving(false);
                });
              }}>取消未提交更正</Button>
            )}
            {!pending && !savingIntent && !saveFailed && correctedText.trim() && (
              <Button type="button" variant="ghost" onClick={() => {
                setCorrectedText(''); setError(''); setNotice('未提交的更正编辑已取消；没有发送命令。');
              }}>取消未提交编辑</Button>
            )}
            <Button type="button" onClick={() => void submitCorrection(!!pending || !!sending || !!saveFailed)}
              disabled={saving || !owner || !!ownerError || (!!recoveryReadError && !pending && !sending) || !client.recordOrganization
                || (!pending && !sending && !saveFailed && (targetIsBlocked || textIssue !== null))}>
              {saving ? <LoaderCircle size={15} className="mr-2 animate-spin" /> : <PencilLine size={15} className="mr-2" />}
              {saving && sending ? '正在发送' : saving ? '正在本机暂存' : pending || sending ? '查证并重试' : saveFailed ? '重试本机暂存' : '保存更正'}
            </Button>
          </DialogFooter>
          {!client.recordOrganization && <p className="text-xs text-destructive" role="alert">当前连接尚不支持更正，请更新 Beta 服务。</p>}
        </DialogContent>
      )}
    </Dialog>
  );
}

function errorMessageForCorrections(error: unknown): string {
  if (error instanceof BetaApiError && error.code === 'invalid_request') {
    return '当前错误没有指出具体字段；更正正文不会经过 Markdown 解析或改写。可保留输入并重试。';
  }
  if (error instanceof BetaApiError && error.code === 'invalid_correction') {
    return '更正内容须非空、Unicode 有效且不超过 128 KiB UTF-8 字节；原始记录保持不变。';
  }
  if (error instanceof BetaApiError && error.code === 'correction_target_conflict') {
    return '原始记录不存在或摘要不匹配；更正未保存，请刷新记录后重试。';
  }
  if (error instanceof BetaApiError && error.code === 'correction_requires_human') {
    return '当前身份不能更正记录；原文保持不变。';
  }
  if (error instanceof Error && error.message) return error.message;
  return '更正服务暂时不可用；原文保持不变。';
}

function latestMatchingCorrection(entries: readonly BetaCorrectionEntry[]): BetaCorrectionEntry | undefined {
  let latest: BetaCorrectionEntry | undefined;
  for (const entry of entries) {
    if (entry.target_state !== 'digest_matches') continue;
    if (!latest || entry.record.local_seq > latest.record.local_seq) latest = entry;
  }
  return latest;
}

function mergeCorrectionEntries(
  current: readonly BetaCorrectionEntry[],
  incoming: readonly BetaCorrectionEntry[],
): BetaCorrectionEntry[] {
  const byEventId = new Map<string, BetaCorrectionEntry>();
  for (const entry of [...current, ...incoming]) {
    if (!byEventId.has(entry.record.event_id)) byEventId.set(entry.record.event_id, entry);
  }
  return [...byEventId.values()].sort((left, right) => right.record.local_seq - left.record.local_seq);
}
