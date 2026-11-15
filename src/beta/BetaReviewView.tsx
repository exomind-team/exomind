import { Sparkles } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ChatMessageRowView } from '@/ui/app/components/ChatMessageRowView';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import type { SummaryArtifactKind, SummaryArtifactView, SummaryMaterialState, SummarySourceRef, SummarySourceSnapshot, SummaryState, SummaryTaskView } from './summary-types';

const statusLabels: Record<SummaryState, string> = {
  waiting_configuration: '等待配置回顾模型', queued: '已排队', running: '正在生成回顾', retry_wait: '等待重试', succeeded: '回顾已生成', failed: '回顾生成失败', cancelled: '回顾已取消',
};
const artifactLabels: Record<SummaryArtifactKind, string> = { review: '回顾', compressed_block: '时间块压缩', compressed_message: '记录压缩', external_summary: '外部总结' };
const materialLabels: Record<SummaryMaterialState, string> = { not_selected: '未选择给模型', missing: '本机缺少原件', verified_available: '原件已校验可用', metadata_only: '仅有原件信息', read_failed: '原件读取失败' };
export interface BetaReviewActions {
  /** The Host adapter supplies only currently available actions. A click carries
   * the displayed task, preserving its expected generation/control heads. */
  cancel?: (task: SummaryTaskView) => void;
  retry?: (task: SummaryTaskView) => void;
  update?: (task: SummaryTaskView) => void;
  configure?: (task: SummaryTaskView) => void;
  openSource?: (source: SummarySourceRef, profileId: string) => void;
  openLatest?: (artifactId: string, profileId: string) => void;
}
export interface BetaReviewViewProps {
  task: SummaryTaskView;
  /** The caller owns the selected version. New task snapshots/results never
   * replace this artifact or its frozen coverage during rendering. */
  artifact?: SummaryArtifactView | null;
  actions?: BetaReviewActions;
  pendingAction?: 'cancel' | 'retry' | 'update' | 'configure' | null;
  localDeviceId?: string;
  now: number;
  dateMode: EventDateDisplayMode;
}
function count(value: number | null): string { return value !== null && Number.isSafeInteger(value) && value >= 0 ? String(value) : '供应商未提供'; }
function coverageLabels(snapshot: SummarySourceSnapshot): string[] {
  const coverage = snapshot.coverage; const labels: string[] = [];
  if (coverage.page_limit) labels.push('达到读取页限，部分材料未纳入');
  if (coverage.input_byte_limit) labels.push('达到材料字节上限，部分记录未纳入');
  if (coverage.omitted_source_ids.length) labels.push(`未纳入记录 ${coverage.omitted_source_ids.length} 条`);
  if (coverage.read_failures.length) labels.push(`读取失败 ${coverage.read_failures.length} 条`);
  if (coverage.missing_parents.length) labels.push(`缺少因果来源 ${coverage.missing_parents.length} 条`);
  if (coverage.metadata_only.length) labels.push(`仅有原件信息 ${coverage.metadata_only.length} 件`);
  if (coverage.unread_originals.length) labels.push(`原件正文未读取 ${coverage.unread_originals.length} 件`);
  if (coverage.remote_visibility === 'known_gap') labels.push('已知其他设备仍有材料待补齐');
  else if (coverage.remote_visibility === 'unknown') labels.push('其他设备的材料是否齐全尚未确认');
  else labels.push('按当时已知来源冻结，未证明所有设备都已补齐');
  return labels;
}

/** Pure Alpha message-row composition. No RPC, model/config imports, storage,
 * polling, automatic source reads, original selection or optimistic success. */
export function BetaReviewView({ task, artifact = null, actions = {}, pendingAction = null, localDeviceId, now, dateMode }: BetaReviewViewProps) {
  if (artifact && (artifact.profile_id !== task.profile_id || artifact.task_id !== task.task_id)) return <p role="alert" className="text-sm text-destructive">回顾版本与当前档案不一致，请刷新后重试</p>;
  const snapshot = artifact?.snapshot ?? task.current_run?.snapshot ?? null;
  const sources = new Map(snapshot?.sources.map(source => [source.event_id, source]));
  const gaps = snapshot ? coverageLabels(snapshot) : [];
  const busy = pendingAction !== null;
  const latest = !!artifact && task.latest_artifact_id === artifact.event_id;
  const newer = !!artifact && !!task.latest_artifact_id && !latest;
  const readOriginals = new Set(artifact?.output.read_original_ids ?? []);
  const evidence = artifact?.output.evidence ?? [];
  const retryAt = task.current_run?.attempt?.retry_at_ms;
  const materialDetails = snapshot && <>
    <p>只披露本机此快照实际纳入的材料，不代表现实活动或所有设备资料完整。</p>
    <ul className="space-y-1">{gaps.map(label => <li key={label}>{label}</li>)}</ul>
    <p>纳入来源 {snapshot.sources.length} 条 · 原件默认不选择给模型</p>
    <p className="flex flex-wrap gap-1">范围：<EventTimestamp timestamp={snapshot.selection.from_ms} now={now} mode={dateMode}/><span>至</span><EventTimestamp timestamp={snapshot.selection.to_ms} now={now} mode={dateMode}/></p>
    {snapshot.materials.map(material => <p key={material.original.original_id} className="break-all">
      {material.original.file_name}：{materialLabels[material.read_state]} · {material.selected ? '已选择给模型' : '未选择给模型'}
      {material.selected && material.read_state === 'verified_available' && readOriginals.has(material.original.original_id) ? ' · 本次结果记录为模型已读' : ' · 不作为模型已读内容'}
    </p>)}
    <details><summary className="cursor-pointer py-1">来源与快照详情</summary><div className="space-y-2 break-all">
      <p>快照指纹：{snapshot.digest}</p><p>输入编码：{snapshot.input_encoded_bytes} 字节</p>
      {snapshot.sources.map(source => <p key={source.event_id}>{source.event_id} · {source.digest}</p>)}
      {!!snapshot.coverage.omitted_source_ids.length && <p>未纳入：{snapshot.coverage.omitted_source_ids.join('、')}</p>}
      {!!snapshot.coverage.read_failures.length && <p>读取失败：{snapshot.coverage.read_failures.join('、')}</p>}
      {!!snapshot.coverage.missing_parents.length && <p>缺少因果来源：{snapshot.coverage.missing_parents.join('、')}</p>}
      {snapshot.origin_heads.map(head => <p key={`${head.origin.device_id}:${head.origin.restoration_epoch}`}>来源设备 {head.origin.device_id} · 位置 {head.cursor.seq} · {head.cursor.hash}</p>)}
    </div></details>
  </>;
  return <ChatMessageRowView eventId={artifact?.event_id ?? task.task_id} tone="system"
    avatar={<Avatar className="mt-0.5 h-8 w-8 shrink-0"><AvatarFallback className="bg-surface text-brand-accent"><Sparkles size={16}/></AvatarFallback></Avatar>}
    metadata={<><span className="text-xs font-semibold text-strong">{artifact ? artifactLabels[artifact.artifact_kind] : '回顾'}</span><span role="status">{statusLabels[task.state]}</span></>}
    content={<div className="space-y-2">
      {artifact ? <p className="whitespace-pre-wrap break-words">{artifact.output.narrative}</p> : <p>尚未生成回顾，原始记录保留。</p>}
      {artifact && !artifact.current && <p className="text-xs text-muted">正在查看保留版本；此版本不是当前有效结果。</p>}
      {newer && <p className="text-xs text-muted">有新版本可查看，当前阅读内容保持不变。</p>}
      {task.coverage_changed && <p role="status" className="text-xs text-muted">有新材料，可更新另存；当前结果不会被覆盖。</p>}
      {!!task.conflicts.length && <p role="alert" className="text-xs text-destructive">生成归属存在冲突，需要确认后继续。</p>}
      {(task.reason || task.current_run?.attempt?.reason) && <p className="text-xs text-muted">当前生成需要处理，请检查配置、归属或稍后刷新。</p>}
      {artifact?.reason && <p className="text-xs text-muted">此结果的当前资格需要核对，来源和原文仍保留。</p>}
      {localDeviceId && <p className="text-xs text-muted">{task.owner_device_id === localDeviceId ? '由本机负责生成' : '由另一设备负责生成，不会自动争抢执行'}</p>}
      {task.state === 'retry_wait' && retryAt !== null && retryAt !== undefined && <p className="text-xs text-muted">可重试时间：<EventTimestamp timestamp={retryAt} now={now} mode={dateMode}/></p>}
      {!!evidence.length && <div className="flex flex-wrap gap-1 text-xs">依据：{evidence.map(id => { const source = sources.get(id); return source ? <Button key={id} variant="ghost" size="sm" disabled={!actions.openSource || busy} onClick={() => actions.openSource?.(source, task.profile_id)}>来源 {id.slice(0,8)}</Button> : <span key={id} role="alert" className="text-destructive">引用来源不在此快照中</span>; })}</div>}
    </div>}
    afterBubble={<details className="mt-2 space-y-2 text-xs text-muted"><summary className="cursor-pointer py-1">生成依据与覆盖</summary><div className="space-y-2">
      {materialDetails ?? <p>材料尚未冻结，不能声明已读取任何记录或原件。</p>}
      {artifact && <><p className="break-all">模型：{artifact.output.model.provider} / {artifact.output.model.model}</p><p>输入用量：{count(artifact.output.usage.input_tokens)} · 输出用量：{count(artifact.output.usage.output_tokens)}</p></>}
      {!!task.conflicts.length && <p className="break-all">冲突来源：{task.conflicts.join('、')}</p>}
    </div></details>}
    actions={<div className="mt-2 flex flex-wrap gap-1">
      {actions.configure && <Button variant="outline" size="sm" disabled={busy} onClick={() => actions.configure?.(task)}>配置回顾模型</Button>}
      {actions.cancel && <Button variant="ghost" size="sm" disabled={busy} onClick={() => actions.cancel?.(task)}>{pendingAction === 'cancel' ? '正在取消…' : '取消生成'}</Button>}
      {actions.retry && <Button variant="outline" size="sm" disabled={busy} onClick={() => actions.retry?.(task)}>重试生成</Button>}
      {actions.update && <Button variant="outline" size="sm" disabled={busy} onClick={() => actions.update?.(task)}>更新另存</Button>}
      {newer && actions.openLatest && <Button variant="ghost" size="sm" disabled={busy} onClick={() => actions.openLatest?.(task.latest_artifact_id!, task.profile_id)}>查看新版本</Button>}
    </div>}/>;
}
