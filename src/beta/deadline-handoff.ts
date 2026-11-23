import { useEffect, useRef, useState } from 'react';
import { BetaApiError } from './api-error';
import { sameDeadlineHandoff, type BetaDeadlineHandoff, type BetaDeadlineHandoffsClient } from './deadline-handoff-client';
import type { BetaTimeblockClient } from './timeblocks-types';

interface HandoffView { pending: BetaDeadlineHandoff | null; busy: boolean; message: string; failed: boolean }
interface HandoffLife {
  active: boolean; revision: number; pending: BetaDeadlineHandoff | null; attempted: string | null; opening: boolean; reading: boolean; again: boolean;
  unsubscribe?: () => void; abort?: AbortController; openedMessage: string;
  refresh(): void; attempt(): void;
}
type Open = (handoff: BetaDeadlineHandoff, current: () => boolean, signal: AbortSignal) => Promise<string>;
const empty: HandoffView = { pending: null, busy: false, message: '', failed: false };
function failure(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  switch (code) {
    case 'handoff_missing_profile': return '通知对应档案不在本机；未创建或切换档案，请确认资料已同步后重试';
    case 'handoff_missing_block': return '通知对应时间块暂未在本机已读取记录中找到，请确认资料后重试';
    case 'handoff_draft_pending': return '当前草稿尚未完成本机暂存，未消费通知入口；请保留窗口并重试';
    case 'handoff_location_pending': return '来源档案尚未完成打开，通知入口仍保留，请重试';
    case 'deadline_handoff_unconfirmed': return '提醒已打开，但系统尚未确认入口已处理，请重试';
    default: return '通知入口尚未完成处理；当前草稿和入口会保留，请重试';
  }
}
/** Read-only startup/event observation. A tap is already an explicit user
 * request; acknowledging it means navigation only, never a Core command. */
export function useBetaDeadlineHandoff(client: BetaDeadlineHandoffsClient | null, scope: string, ready: boolean, open: Open): HandoffView & { retry(): void } {
  const [view, setView] = useState<HandoffView>(empty); const [subscription, setSubscription] = useState(0);
  const active = useRef<HandoffLife | null>(null); const latest = useRef({ ready, open }); latest.current = { ready, open };
  useEffect(() => {
    setView(empty);
    if (!client || !scope) { active.current = null; return; }
    const life: HandoffLife = { active: true, revision: 0, pending: null, attempted: null, opening: false, reading: false, again: false, openedMessage: '', refresh: () => {}, attempt: () => {} };
    active.current = life;
    const live = () => life.active && active.current === life;
    const replace = (pending: BetaDeadlineHandoff | null) => {
      life.pending = pending;
      setView({ pending, busy: false, failed: false, message: pending ? '收到时间块提醒，正在准备打开来源档案…' : life.openedMessage });
    };
    life.attempt = () => {
      const target = life.pending;
      if (!live() || !latest.current.ready || !target || life.opening || life.reading || life.attempted === target.handoff_id) return;
      life.opening = true; life.attempted = target.handoff_id; const revision = life.revision;
      const abort = new AbortController(); life.abort = abort;
      const current = () => live() && !abort.signal.aborted && revision === life.revision && sameDeadlineHandoff(life.pending, target);
      setView({ pending: target, busy: true, failed: false, message: '正在暂存当前草稿并打开提醒来源…' });
      void (async () => {
        try {
          const before = await client.pending(); if (!current()) return;
          if (!sameDeadlineHandoff(before, target)) { ++life.revision; life.attempted = null; replace(before); return; }
          const message = await latest.current.open(target, current, abort.signal); if (!current()) return;
          life.openedMessage = message;
          const beforeAck = await client.pending(); if (!current()) return;
          if (!sameDeadlineHandoff(beforeAck, target)) { ++life.revision; life.attempted = null; replace(beforeAck); return; }
          const acknowledged = await client.acknowledge(target.handoff_id); if (!current()) return;
          if (!acknowledged) {
            const replacement = await client.pending(); if (!current()) return;
            if (sameDeadlineHandoff(replacement, target)) throw new BetaApiError('deadline_handoff_unconfirmed', '通知入口尚未确认');
            ++life.revision; life.attempted = null; replace(replacement); return;
          }
          life.pending = null; setView({ pending: null, busy: false, failed: false, message });
        } catch (error) {
          if (current()) setView({ pending: target, busy: false, failed: true, message: failure(error) });
        } finally {
          life.opening = false; if (life.abort === abort) life.abort = undefined;
          if (live()) life.attempt();
        }
      })();
    };
    life.refresh = () => {
      if (!live()) return;
      if (life.reading) { life.again = true; return; }
      life.reading = true; const revision = life.revision; let read = false;
      void Promise.resolve().then(() => client.pending()).then(pending => {
        if (!live()) return;
        if (revision !== life.revision) { life.again = true; return; }
        read = true; replace(pending);
      }).catch(error => {
        if (live() && revision === life.revision) setView({ pending: life.pending, busy: false, failed: true, message: failure(error) });
      }).finally(() => {
        life.reading = false;
        if (!live()) return;
        if (life.again) { life.again = false; life.refresh(); } else if (read) life.attempt();
      });
    };
    // Install the listener before the startup read. Events fence an in-flight
    // opener immediately, even while the latest pending read is still queued.
    void Promise.resolve().then(() => client.subscribe(() => { if (live()) { ++life.revision; life.abort?.abort(); life.refresh(); } })).then(unsubscribe => {
      if (!live()) { unsubscribe(); return; } life.unsubscribe = unsubscribe; life.refresh();
    }).catch(error => { if (live()) setView({ pending: null, busy: false, failed: true, message: failure(error) }); });
    return () => { life.active = false; ++life.revision; life.abort?.abort(); life.unsubscribe?.(); };
  }, [client, scope, subscription]);
  useEffect(() => { if (ready) active.current?.attempt(); }, [ready]);
  return { ...view, retry() {
    const life = active.current;
    if (!life?.active) return;
    if (!latest.current.ready) {
      setView({
        pending: life.pending,
        busy: false,
        failed: true,
        message: life.pending
          ? '本机连接或档案切换尚未就绪，提醒入口仍保留。请先完成当前恢复操作，再重试。'
          : '本机连接或档案切换尚未就绪，暂不能确认提醒入口。请先恢复连接后重新读取。',
      });
      return;
    }
    if (!life.unsubscribe) { setSubscription(value => value + 1); return; }
    ++life.revision; life.abort?.abort(); life.attempted = null; life.refresh();
  } };
}

/** Locate the source in an authoritative snapshot first. Older/completed
 * blocks get a bounded immutable-history lookup; unknown is never completed. */
export async function describeDeadlineHandoff(client: BetaTimeblockClient, handoff: BetaDeadlineHandoff, current: () => boolean): Promise<string> {
  const snapshot = await client.snapshot(handoff.profile_id);
  if (!current() || snapshot.profile_id !== handoff.profile_id) throw new BetaApiError('handoff_location_pending', '提醒来源尚未确认');
  const prefix = `提醒时间块 ${handoff.block_id.slice(0, 8)}：`;
  if (snapshot.active?.block_id === handoff.block_id) {
    return prefix + (snapshot.active.phase === 'completed' ? '已完成，已打开来源档案的时间块。' : snapshot.active.phase === 'feedback_pending' ? '行动已结束，等待反馈。' : snapshot.active.phase === 'paused' ? '当前已暂停。' : '当前仍在运行。');
  }
  if (snapshot.pending_feedback.includes(handoff.block_id)) return prefix + '行动已结束，等待反馈；已打开来源档案的时间块。';
  let before: number | undefined; let through: number | undefined;
  for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
    const page = await client.nodes(handoff.profile_id, { limit: 100, ...(before === undefined ? {} : { before }), ...(through === undefined ? {} : { through }) });
    if (!current() || through !== undefined && through !== page.highwater || page.items.some(node => node.profile_id !== handoff.profile_id)) throw new BetaApiError('handoff_location_pending', '提醒来源尚未确认');
    let found = false; let completed = false;
    for (const node of page.items) {
      const payload = node.payload;
      if (payload.kind !== 'action') { found ||= payload.block_id === handoff.block_id; continue; }
      const action = payload.action;
      if (action.kind === 'rotate') found ||= action.from_block_id === handoff.block_id || action.next.block_id === handoff.block_id;
      else if (action.block_id === handoff.block_id) { found = true; completed ||= action.kind === 'submit_feedback'; }
    }
    if (found) return prefix + (completed ? '已完成；已打开来源档案的时间块与历史。' : snapshot.active ? '当前正在另一时间块；可在历史中查看本提醒来源。' : '当前已不在行动或待反馈列表；可在历史中核对来源。');
    if (page.next_before === null) break;
    if (before !== undefined && page.next_before >= before) throw new BetaApiError('handoff_location_pending', '提醒来源尚未确认');
    before = page.next_before; through ??= page.highwater;
  }
  throw new BetaApiError('handoff_missing_block', '提醒来源时间块暂未找到');
}
