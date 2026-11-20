import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import { BetaApiError } from './api-error';
import type { BetaTimelineItem } from './timeblocks-types';
import type { SummarySourceRef } from './summary-types';
import type { BetaCorrectionEntry } from './record-organization-client';
import { validateCorrectionSourceEntry, type CorrectionSourceReader } from './correction-source-client';
import { betaTimeblockLabel } from './timeblock-label';

export type SummarySourceReader = (profileId: string, eventId: string) => Promise<BetaTimelineItem | null>;

type TimelineResult = {
  kind: 'timeline';
  profileId: string;
  sourceProfileId: string;
  source: SummarySourceRef;
  reader: SummarySourceReader;
  item: BetaTimelineItem | null;
};

type CorrectionResult = {
  kind: 'correction';
  profileId: string;
  sourceProfileId: string;
  source: SummarySourceRef;
  reader: CorrectionSourceReader;
  entry: BetaCorrectionEntry | null;
};

type SourceResult = TimelineResult | CorrectionResult;

function sourceReadError(error: unknown): string {
  if (error instanceof BetaApiError) {
    if (error.code === 'unsupported_correction_source') return '当前服务未声明精确更正来源读取能力，请更新到同版 Beta。';
    if (error.code === 'forbidden') return '当前授权不能查看这条来源。';
    if (error.code === 'unauthorized') return '当前授权已失效，请重新连接。';
    if (error.code === 'source_service_changed') return '本机服务已变化，请重新连接后查看来源。';
    if (error.code === 'recovery_required' || error.code === 'storage_error') return '本机来源资料暂不能读取，现有记录已保留。';
  }
  return '来源读取尚未完成或与引用不一致，未呈现正文；请重试。';
}

export function BetaSummarySourceDialog({
  profileId,
  sourceProfileId,
  source,
  reader,
  correctionReader,
  onClose,
  now,
  dateMode,
}: {
  profileId: string;
  sourceProfileId: string | null;
  source: SummarySourceRef | null;
  reader?: SummarySourceReader;
  correctionReader?: CorrectionSourceReader;
  onClose: () => void;
  now: number;
  dateMode: EventDateDisplayMode;
}) {
  const [result, setResult] = useState<SourceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const requestSequence = useRef(0);
  const scopeMatches = source !== null && sourceProfileId === profileId;
  const isCorrection = source?.kind === 'correction/1';
  const isTimelineSource = source?.kind === 'capture' || source?.kind === 'timeblock/1';
  const activeReader = isCorrection ? correctionReader : isTimelineSource ? reader : undefined;

  useEffect(() => {
    const sequence = ++requestSequence.current;
    let active = true;
    setResult(null);
    setError('');
    if (!source || !scopeMatches || !activeReader) {
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    const read = isCorrection
      ? Promise.resolve().then(() => correctionReader!(profileId, source.event_id, source.digest)).then(value => {
        const entry = validateCorrectionSourceEntry(value, profileId, source.event_id, source.digest);
        if (!active || sequence !== requestSequence.current) return;
        setResult({ kind: 'correction', profileId, sourceProfileId: profileId, source, reader: correctionReader!, entry });
      })
      : Promise.resolve().then(() => reader!(profileId, source.event_id)).then(item => {
        if (item && (item.record.profile_id !== profileId || item.record.event_id !== source.event_id
          || item.record.digest !== source.digest
          || source.kind === 'capture' && item.kind !== 'capture'
          || source.kind === 'timeblock/1' && item.kind !== 'timeblock')) {
          throw new Error('Source binding mismatch');
        }
        if (!active || sequence !== requestSequence.current) return;
        setResult({ kind: 'timeline', profileId, sourceProfileId: profileId, source, reader: reader!, item });
      });

    void read.catch(failure => {
      if (active && sequence === requestSequence.current) {
        setError(sourceReadError(failure));
      }
    }).finally(() => {
      if (active && sequence === requestSequence.current) setLoading(false);
    });
    return () => {
      active = false;
      if (requestSequence.current === sequence) requestSequence.current++;
    };
  }, [profileId, sourceProfileId, source?.event_id, source?.digest, source?.kind, scopeMatches, isCorrection, activeReader, reader, correctionReader, revision]);

  const bound = result && result.profileId === profileId && result.sourceProfileId === sourceProfileId
    && result.source.event_id === source?.event_id && result.source.kind === source?.kind
    && result.source.digest === source?.digest
    && (result.kind === 'correction' ? result.reader === correctionReader : result.reader === reader)
    ? result
    : null;
  const supported = isCorrection ? correctionReader !== undefined : isTimelineSource && reader !== undefined;

  return (
    <Dialog open={scopeMatches} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto scrollbar-none">
        <DialogHeader>
          <DialogTitle>引用来源</DialogTitle>
          <DialogDescription>只读取当前档案中的精确来源；不会扫描其他历史或自动读取原件正文。</DialogDescription>
        </DialogHeader>

        {!supported && scopeMatches && <p role="status" className="text-sm text-muted">
          {isCorrection ? '当前连接未声明精确更正来源读取能力。' : '当前连接尚未提供此来源类型的精确读取能力。'}
        </p>}
        {supported && loading && <p role="status" className="text-sm text-muted">正在读取来源…</p>}
        {supported && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {bound?.kind === 'timeline' && !bound.item && <p className="text-sm text-muted">本机没有可见的该来源，未声称已读。</p>}
        {bound?.kind === 'correction' && !bound.entry && <p className="text-sm text-muted">本机没有可见的这条更正记录，未声称已读。</p>}

        {bound?.kind === 'timeline' && bound.item && (
          <TimelineSourceView item={bound.item} now={now} dateMode={dateMode} />
        )}
        {bound?.kind === 'correction' && bound.entry && (
          <CorrectionSourceView
            key={`${profileId}:${bound.entry.record.event_id}:${bound.entry.record.digest}`}
            profileId={profileId}
            entry={bound.entry}
            reader={reader}
            now={now}
            dateMode={dateMode}
          />
        )}

        {supported && <Button variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)}>
          重新读取此来源
        </Button>}
      </DialogContent>
    </Dialog>
  );
}

function TimelineSourceView({ item, now, dateMode }: { item: BetaTimelineItem; now: number; dateMode: EventDateDisplayMode }) {
  return (
    <div className="space-y-2 text-sm">
      <EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={dateMode} />
      {item.kind === 'capture' ? (
        <>
          <p className="whitespace-pre-wrap break-words">{item.record.text || '此记录仅引用原件。'}</p>
          {!!item.record.originals?.length && <div className="space-y-1 text-xs text-muted">
            <p>原件清单仅为元数据；没有读取原件正文。</p>
            {item.record.originals.map(original => <p key={original.original_id} className="break-all">
              {original.file_name} · {original.byte_length} 字节
            </p>)}
          </div>}
        </>
      ) : item.kind === 'timeblock' ? (
        <p className="whitespace-pre-wrap break-words">{betaTimeblockLabel(item.record)}</p>
      ) : (
        <p>此内容类型与引用不一致，未呈现为来源。</p>
      )}
    </div>
  );
}

function CorrectionSourceView({
  profileId,
  entry,
  reader,
  now,
  dateMode,
}: {
  profileId: string;
  entry: BetaCorrectionEntry;
  reader?: SummarySourceReader;
  now: number;
  dateMode: EventDateDisplayMode;
}) {
  const stateText = entry.target_state === 'digest_matches'
    ? '关联状态：目标记录摘要与更正声明一致。'
    : entry.target_state === 'unresolved'
      ? '关联状态：目标记录当前未找到（未解析）。'
      : '关联状态：目标摘要冲突，未确认其关联到当前原文。';

  return (
    <div className="space-y-3 text-sm">
      <EventTimestamp timestamp={entry.record.occurred_at_ms} now={now} mode={dateMode} />
      <section className="space-y-2 rounded-lg border border-border-subtle bg-card p-3">
        <h3 className="font-medium">更正记录</h3>
        <p className="whitespace-pre-wrap break-words">{entry.record.corrected_text}</p>
      </section>
      <section className="space-y-1 rounded-lg border border-border-subtle p-3">
        <h3 className="font-medium">原文关联</h3>
        <p>{stateText}</p>
        <p className="break-all text-xs text-muted">目标事件：{entry.record.target_event_id}</p>
        <p className="text-xs text-muted">此更正保留为独立记录，不覆盖原文，也不表示内容只有这一版或这是最新一版。</p>
      </section>
      {entry.target_state === 'digest_matches' && reader && (
        <CorrectionTargetView profileId={profileId} entry={entry} reader={reader} now={now} dateMode={dateMode} />
      )}
    </div>
  );
}

function CorrectionTargetView({
  profileId,
  entry,
  reader,
  now,
  dateMode,
}: {
  profileId: string;
  entry: BetaCorrectionEntry;
  reader: SummarySourceReader;
  now: number;
  dateMode: EventDateDisplayMode;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [item, setItem] = useState<BetaTimelineItem | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setItem(null);
    setMissing(false);
    setError(false);
    void reader(profileId, entry.record.target_event_id).then(value => {
      if (!active) return;
      if (!value) {
        setMissing(true);
      } else if (value.kind !== 'capture' || value.record.profile_id !== profileId
        || value.record.event_id !== entry.record.target_event_id || value.record.digest !== entry.record.target_digest) {
        setError(true);
      } else {
        setItem(value);
      }
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, profileId, entry.record.target_event_id, entry.record.target_digest, reader]);

  return (
    <section className="space-y-2">
      <Button variant="outline" disabled={loading} onClick={() => setOpen(value => !value)}>
        {open ? '收起目标原文' : '查看目标原文'}
      </Button>
      {open && loading && <p role="status" className="text-sm text-muted">正在读取目标原文…</p>}
      {open && missing && <p className="text-sm text-muted">当前档案没有可见的目标原文，未呈现正文。</p>}
      {open && error && <p role="alert" className="text-sm text-destructive">目标原文与更正声明不一致，未呈现正文。</p>}
      {open && item?.kind === 'capture' && <div className="space-y-2 rounded-lg border border-border-subtle p-3">
        <EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={dateMode} />
        <p className="whitespace-pre-wrap break-words">{item.record.text || '此记录仅引用原件。'}</p>
        {!!item.record.originals?.length && <div className="space-y-1 text-xs text-muted">
          <p>原件清单仅为元数据；没有读取原件正文。</p>
          {item.record.originals.map(original => <p key={original.original_id} className="break-all">
            {original.file_name} · {original.byte_length} 字节
          </p>)}
        </div>}
      </div>}
    </section>
  );
}
