import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { BetaClient } from './client';
import { originalAcquisitionError, sameOriginal, type BetaOriginalTransferStatus } from './original-acquisition';
import type { BetaOriginal } from './original-types';
import {
  visibleOriginalDiagnosticCode,
  type BetaOriginalAutoDiagnostics,
} from './original-auto-diagnostics';

type ReadState<T> =
  | { kind: 'unread' | 'loading' | 'unsupported' | 'failed' }
  | { kind: 'ready'; value: T };

const AVAILABILITY_LABELS: Record<BetaOriginalTransferStatus['availability'], string> = {
  missing: '本机缺少原件字节，仅有记录信息',
  partial: '本机已有部分原件字节',
  complete: '本机原件已完整校验',
  hash_mismatch: '本机原件校验失败',
};
const TRANSFER_PHASE_LABELS: Record<BetaOriginalTransferStatus['transfer_state'], string> = {
  idle: '当前没有活动传输',
  receiving: '正在接收原件',
  verifying: '正在校验原件',
  confirming: '正在确认传输结果',
  failed: '最近一次传输失败',
  cancelled: '最近一次传输已取消',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return String(bytes) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MiB';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{children}</dd></>;
}

function readStateLabel(kind: ReadState<unknown>['kind'], unsupported: string): string {
  switch (kind) {
    case 'unread': return '尚未读取';
    case 'loading': return '读取中…';
    case 'unsupported': return unsupported;
    case 'failed': return '读取失败，可刷新重试';
    case 'ready': return '已读取';
  }
}

function normalizedCode(value: string | null): ReactNode {
  if (value === null) return '未记录错误码';
  const safe = visibleOriginalDiagnosticCode(value);
  return safe
    ? <code className="break-all font-mono">{safe}</code>
    : '未知规范码；原始错误文本已隐藏';
}

function recoveryHint(value: string | null): string | null {
  if (value === null) return null;
  const safe = visibleOriginalDiagnosticCode(value);
  return safe
    ? originalAcquisitionError(safe)
    : '原始错误文本已隐藏；请检查设备连接与授权后重试';
}

export function OriginalTransferDiagnostics({
  client,
  profileId,
  original,
  visible,
}: {
  client: BetaClient;
  profileId: string;
  original: BetaOriginal;
  visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [transfer, setTransfer] = useState<ReadState<BetaOriginalTransferStatus>>({ kind: 'unread' });
  const [queue, setQueue] = useState<ReadState<BetaOriginalAutoDiagnostics>>({ kind: 'unread' });
  const lifetime = useRef<object | null>(null);
  const request = useRef<object | null>(null);
  const detailsId = 'original-transfer-diagnostics-' + useId();

  useEffect(() => {
    const owner = {};
    lifetime.current = owner;
    request.current = null;
    setOpen(false);
    setTransfer({ kind: 'unread' });
    setQueue({ kind: 'unread' });
    return () => {
      if (lifetime.current === owner) lifetime.current = null;
      request.current = null;
    };
  }, [client, profileId, original.original_id, original.sha256, original.byte_length, original.file_name, original.media_type, visible]);

  function readOnce() {
    const owner = lifetime.current;
    if (!visible || !owner) return;
    const readRequest = {};
    request.current = readRequest;
    setTransfer({ kind: 'loading' });
    setQueue(client.originalAutoDiagnostics ? { kind: 'loading' } : { kind: 'unsupported' });
    const ownsResult = () => visible && lifetime.current === owner && request.current === readRequest;

    if (client.originalAcquisition) {
      void Promise.resolve()
        .then(async () => {
          if (!ownsResult()) return;
          const status = await client.originalAcquisition!.status(profileId, original.original_id);
          if (!ownsResult()) return;
          const matches = status.profile_id === profileId
            && status.original_id === original.original_id
            && sameOriginal(original, status.original);
          setTransfer(matches ? { kind: 'ready', value: status } : { kind: 'failed' });
        })
        .catch(() => { if (ownsResult()) setTransfer({ kind: 'failed' }); });
    } else {
      setTransfer({ kind: 'unsupported' });
    }

    if (client.originalAutoDiagnostics) {
      void Promise.resolve()
        .then(async () => {
          if (!ownsResult()) return;
          const value = await client.originalAutoDiagnostics!.status();
          if (ownsResult()) setQueue({ kind: 'ready', value });
        })
        .catch(() => { if (ownsResult()) setQueue({ kind: 'failed' }); });
    }
  }

  function close() {
    request.current = null;
    setOpen(false);
    setTransfer({ kind: 'unread' });
    setQueue({ kind: 'unread' });
  }

  if (!visible) return null;
  const reading = transfer.kind === 'loading' || queue.kind === 'loading';
  const transferStatus = transfer.kind === 'ready' ? transfer.value : null;
  const transferError = transferStatus?.last_error_code ?? null;
  const queueError = queue.kind === 'ready' ? queue.value.last_error_code : null;
  const transferRecovery = recoveryHint(transferError);
  const queueRecovery = recoveryHint(queueError);

  return <div className="contents">
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      aria-expanded={open}
      aria-controls={open ? detailsId : undefined}
      aria-label={(open ? '收起 ' : '查看 ') + original.file_name + ' 的传输诊断'}
      onClick={() => {
        if (open) close();
        else { setOpen(true); readOnce(); }
      }}
    ><Info size={14} aria-hidden="true" /></Button>
    {open && <section id={detailsId} aria-label={original.file_name + ' 的传输诊断'} className="w-full basis-full space-y-2 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 text-muted">本项状态按需读取；自动队列字段是本机全局快照。</p>
        <Button variant="ghost" size="sm" disabled={reading} aria-label={'刷新 ' + original.file_name + ' 的传输诊断'} onClick={readOnce}>
          <RefreshCw size={12} className="mr-1" aria-hidden="true" />{reading ? '读取中…' : '刷新'}
        </Button>
      </div>
      <dl className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
        <Field label="原件 ID"><code className="break-all font-mono">{original.original_id}</code></Field>
        <Field label="SHA-256"><code className="break-all font-mono">{original.sha256}</code></Field>
        <Field label="记录长度">{String(original.byte_length)} B（{formatBytes(original.byte_length)}）</Field>
        <Field label="本机可用性">{transferStatus ? AVAILABILITY_LABELS[transferStatus.availability] : readStateLabel(transfer.kind, '当前连接未提供原件状态接口')}</Field>
        <Field label="传输阶段">{transferStatus ? TRANSFER_PHASE_LABELS[transferStatus.transfer_state] : readStateLabel(transfer.kind, '当前连接未提供原件状态接口')}</Field>
        <Field label="字节进度">
          {transferStatus ? <div className="space-y-1">
            <p>{String(transferStatus.next_offset)} / {String(transferStatus.byte_length)} B（{formatBytes(transferStatus.next_offset)} / {formatBytes(transferStatus.byte_length)}）</p>
            <Progress className="h-1 w-full" aria-label={original.file_name + ' 原件诊断字节进度'} value={transferStatus.next_offset} max={Math.max(1, transferStatus.byte_length)} />
          </div> : readStateLabel(transfer.kind, '当前连接未提供原件状态接口')}
        </Field>
        <Field label="当前请求">{transferStatus?.request_id ? <code className="break-all font-mono">{transferStatus.request_id}</code> : transferStatus ? '无活动请求' : readStateLabel(transfer.kind, '当前连接未提供原件状态接口')}</Field>
        <Field label="来源设备">{transferStatus?.peer_device_id ? <code className="break-all font-mono">{transferStatus.peer_device_id}</code> : transferStatus ? '无活动来源' : readStateLabel(transfer.kind, '当前连接未提供原件状态接口')}</Field>
        <Field label="原件失败码">{transferStatus ? normalizedCode(transferError) : readStateLabel(transfer.kind, '当前连接未提供原件状态接口')}</Field>
        {transferRecovery && <><dt className="text-muted">恢复提示</dt><dd className="min-w-0">{transferRecovery}</dd></>}
      </dl>
      <div className="space-y-1 border-t border-border-subtle pt-2">
        <p className="font-medium">本机自动获取队列</p>
        <p className="text-muted">队列统计不能证明此原件已入队、满足来源条件或已完成传输。</p>
        {queue.kind === 'ready' ? <dl className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
          <Field label="同步网络">{queue.value.network_enabled ? '已开启' : '已关闭'}</Field>
          <Field label="自动获取策略">{queue.value.policy_enabled ? '已开启' : '已关闭'}</Field>
          <Field label="单件上限">{String(queue.value.max_bytes)} B（{formatBytes(queue.value.max_bytes)}）</Field>
          <Field label="活动获取请求">{queue.value.active_outbound}</Field>
          <Field label="队列延迟标记">{queue.value.deferred ? '已标记延迟' : '当前未标记延迟'}</Field>
          <Field label="队列失败码">{normalizedCode(queueError)}</Field>
          {queueRecovery && <><dt className="text-muted">恢复提示</dt><dd className="min-w-0">{queueRecovery}</dd></>}
        </dl> : <p role={queue.kind === 'failed' ? 'alert' : 'status'} className={queue.kind === 'failed' ? 'text-destructive' : 'text-muted'}>
          {readStateLabel(queue.kind, '当前 Native 服务未提供自动队列诊断接口')}
        </p>}
      </div>
    </section>}
  </div>;
}
