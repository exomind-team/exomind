import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BetaDraftController } from './drafts';
import { BetaShareHandoffCard } from './BetaShareHandoffCard';
import { betaShareHandoffSourceId, type BetaShareHandoffSummary, type BetaShareHandoffsClient } from './share-handoff-client';
import type { BetaShareHandoffQueueSnapshot } from './share-handoff-queue';
import type { SharedHandoffAttachmentFile } from './native-attachment-types';

function errorCode(failure: unknown): string {
  return failure && typeof failure === 'object' && 'code' in failure
    && typeof failure.code === 'string' && /^[a-z0-9_]{1,96}$/i.test(failure.code) ? failure.code : '';
}

function safeError(failure: unknown): string {
  const code = errorCode(failure);
  if(code==='profile_conflict')return '此分享已绑定到另一档案；当前档案未能继续处理。请切换到显示的归属档案。';
  if(code==='share_handoff_profile_unbound')return '分享尚未绑定到档案，未创建草稿内容；请重试添加以先完成档案关联。';
  if(code==='share_handoff_receiving')return '分享仍在接收，尚未加入草稿；请等待接收完成，或取消本次接收后重试。';
  if(code==='capture_text_too_large')return '分享文字与当前草稿合计超过单条记录上限；原草稿与分享均保留，请先发送或缩短当前草稿再重试。';
  if(code==='source_incomplete')return '本机附件尚未完成完整性校验；未确认的分享附件仍保留，请重试或重新分享。';
  if(code==='permission_unavailable')return '来源应用已撤回读取权限；请回来源应用重新分享，已加入草稿的内容保留。';
  if(code==='content_unavailable')return '来源内容目前无法读取；请回来源应用重新分享。';
  if(code==='size_mismatch')return '来源文件大小与实际内容不一致；这份附件未加入草稿。';
  if(code==='storage_unavailable')return '设备可用存储空间不足，分享暂存未完成；请先释放设备存储空间，再回来源应用重新分享原始内容。已加入草稿的内容保留。';
  if(code==='quota_exceeded')return '本机分享暂存额度已满；已加入草稿的文字和附件仍保留。请先处理待处理分享，再从来源应用补发未完成内容。';
  if(code==='interrupted'||code==='cancelled'||code==='attachment_cancelled'||code==='selection_removed')return '分享接收已停止；已完成内容保留，未完成项仍在暂存中。需要继续时请从来源应用重新分享。';
  if(code==='cancel_pending')return '取消仍在请求中，系统尚未确认接收停止；可再次取消或等待最终状态。';
  if(code==='partial_handoff')return '部分分享内容尚未加入草稿；已完成的文字和附件保留，请重试未完成项。';
  return code
    ? `系统分享未能全部加入草稿（${code}）；已加入的内容保留，未完成项仍在分享暂存中。`
    : '系统分享未能全部加入草稿；已加入的内容保留，未完成项仍在分享暂存中。';
}

function hasPendingContent(handoff: BetaShareHandoffSummary): boolean {
  return handoff.state!=='acknowledged'
    && (handoff.state === 'receiving' || handoff.state === 'interrupted' || handoff.state === 'cancelled'
      || handoff.text_state === 'ready' || handoff.text_state === 'receiving' || handoff.text_state === 'interrupted'
      || handoff.items.some(item => item.state !== 'acknowledged' && item.state !== 'cancelled'));
}
function itemError(code?: string | null,recoveryInstruction?:string|null): string | undefined {
  if(!code)return undefined;
  if(code==='permission_unavailable')return '来源权限已失效，请回来源应用重新分享。';
  if(code==='content_unavailable')return '来源内容目前不可读，请回来源应用重新分享。';
  if(code==='storage_unavailable')return '设备可用存储空间不足；请先释放设备存储空间，再回来源应用重新分享原始内容。';
  if(code==='size_mismatch')return '来源文件大小与实际内容不一致，这份附件未加入草稿。';
  if(code==='quota_exceeded')return '本机分享暂存额度已满；已完成暂存的项目仍可加入草稿，请先处理现有分享后再补发未完成项。';
  if(code==='interrupted'||code==='cancelled')return '附件接收未完成；请回来源应用重新分享原文件。';
  return recoveryInstruction || `接收未完成（${code}）`;
}

export function BetaShareHandoffInbox({
  client, queue, controller, profileId, profileName, profileNameFor = id => id, onSwitchProfile,
}: {
  client: BetaShareHandoffsClient;
  queue: BetaShareHandoffQueueSnapshot & { refresh: () => Promise<void> };
  controller: BetaDraftController;
  profileId: string;
  profileName: string;
  profileNameFor?: (profileId: string) => string;
  onSwitchProfile?: (profileId: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const flights = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function withFlight(handoffId: string, operation: () => Promise<void>): Promise<void> {
    if (flights.current.has(handoffId)) return;
    flights.current.add(handoffId);
    if (mounted.current) { setBusyId(handoffId); setErrors(previous => ({ ...previous, [handoffId]: '' })); }
    try { await operation(); }
    catch (failure) {
      if (errorCode(failure) === 'profile_conflict') await queue.refresh();
      if (mounted.current) setErrors(previous => ({ ...previous, [handoffId]: safeError(failure) }));
    }
    finally {
      flights.current.delete(handoffId);
      if (mounted.current) setBusyId(current => current === handoffId ? null : current);
    }
  }

  async function addToDraft(handoffId: string): Promise<void> {
    await withFlight(handoffId, async () => {
      const handoff = await client.get(handoffId, profileId);
      if(!handoff)throw Object.assign(new Error('分享已不存在'),{code:'share_handoff_not_found'});
      // Bind first: Native rejects imports and acknowledgements for unbound
      // handoffs, and a profile conflict must never leave split draft content.
      await client.bindProfile(handoffId, profileId);
      let incomplete = handoff.text_state === 'interrupted' || handoff.text_state === 'receiving';
      const failures: unknown[] = [];
      if (handoff.text_state === 'ready') {
        try {
          if (handoff.text) await controller.appendSharedHandoffText(profileId, handoffId, handoff.text);
          await client.acknowledgeText(handoffId, profileId);
        } catch (failure) { failures.push(failure); }
      }
      for (const item of handoff.items) {
        if (item.state === 'acknowledged' || item.state === 'cancelled') continue;
        if (item.state !== 'ready') { incomplete = true; continue; }
        try {
          const source: SharedHandoffAttachmentFile = {
            kind: 'shared_handoff_file', handoffId, itemId: item.item_id, profileId,
            name: item.name, size: item.byte_length, type: item.media_type || 'application/octet-stream',
          };
          const sourceId = betaShareHandoffSourceId(handoffId, item.item_id);
          const [attachmentId] = await controller.addFiles(profileId, [source], { sourceIds: [sourceId] });
          const draftFile = controller.snapshot().drafts[profileId]?.files?.find(file => file.id === attachmentId);
          // addFiles preserves a failed row for recovery instead of rejecting. Do
          // not consume the Native handoff unless the complete local source has
          // an integrity-bound original in the durable draft.
          if (!draftFile?.original) throw Object.assign(new Error('本机附件尚未完整校验'), { code: 'source_incomplete' });
          await controller.flush();
          await client.acknowledgeItem(handoffId, item.item_id, profileId);
        } catch (failure) { failures.push(failure); }
      }
      await queue.refresh();
      if (failures.length) throw failures[0];
      if (incomplete) throw Object.assign(new Error('部分分享内容尚未加入草稿；已完成的文字和附件保留。'), {
        code: handoff.error_code ?? 'partial_handoff',
      });
    });
  }

  async function cancelReceive(handoffId: string): Promise<void> {
    await withFlight(handoffId, async () => {
      const result=await client.cancel(handoffId);
      await queue.refresh();
      if(result.status==='receiving')throw Object.assign(new Error('取消仍在等待确认'),{code:'cancel_pending'});
    });
  }
  async function discard(handoffId: string): Promise<void> {
    await withFlight(handoffId, async () => { await client.discard(handoffId, profileId); await queue.refresh(); });
  }

  const visible = queue.handoffs.filter(handoff => handoff.state !== 'acknowledged' && (!handoff.profile_match || hasPendingContent(handoff)));
  return <div className="space-y-2" data-testid="beta-share-handoff-inbox">
    {queue.error && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-page px-3 py-2">
      <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">系统分享状态未知，暂不能确认是否已在本机暂存。请保留来源应用中的原始内容，可重试读取。</p>
      <Button type="button" variant="outline" size="sm" onClick={() => { void queue.refresh(); }}>重新读取</Button>
    </div>}
    {queue.loading && !queue.handoffs.length && <p role="status" className="text-[11px] text-muted">正在查证待处理的系统分享…</p>}
    {visible.map(handoff => {
      const busy = busyId === handoff.handoff_id;
      const state = busy ? 'importing' : handoff.state === 'interrupted'||handoff.state==='acknowledged' ? 'failed' : handoff.state;
      const foreign = !handoff.profile_match;
      const boundProfileName = handoff.bound_profile_id ? profileNameFor(handoff.bound_profile_id) : undefined;
      return <BetaShareHandoffCard
        key={handoff.handoff_id}
        handoffId={handoff.handoff_id}
        profileName={profileName}
        text={foreign ? '' : handoff.text_preview??''}
        textState={foreign ? 'none' : handoff.text_state==='acknowledged'?'imported':handoff.text_state==='interrupted'?'failed':handoff.text_state}
        items={foreign ? [] : handoff.items.map(item => ({ id: item.item_id, name: item.name, mediaType: item.media_type,
          byteLength: item.byte_length, state:item.state==='acknowledged'?'imported':item.state==='interrupted'?'failed':item.state,
          message:itemError(item.error_code,item.recovery_instruction) }))}
        state={state}
        profileMismatch={foreign}
        boundProfileName={boundProfileName}
        error={errors[handoff.handoff_id] || (!foreign ? handoff.recovery_instruction || itemError(handoff.error_code) : undefined) || undefined}
        onCancelReceive={() => cancelReceive(handoff.handoff_id)}
        onAddToDraft={() => addToDraft(handoff.handoff_id)}
        onDiscard={() => discard(handoff.handoff_id)}
        onSwitchToBoundProfile={foreign && handoff.bound_profile_id && onSwitchProfile
          ? () => onSwitchProfile(handoff.bound_profile_id!) : undefined}
        onRefresh={queue.refresh}
      />;
    })}
  </div>;
}
