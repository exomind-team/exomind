import { useState, useSyncExternalStore, type ReactElement } from 'react';
import { LoaderCircle, Mic, Paperclip, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/tooltip';
import {
  BetaAudioRecordingController,
  type BetaAudioAttachmentSink,
} from './beta-audio-recording';
import { BetaMediaPreview } from './BetaMediaPreview';

export interface BetaAudioRecorderProps {
  /** Supplied by the stable device workspace owner, never created by this view. */
  controller: BetaAudioRecordingController;
  profileId: string;
  profileName?: string;
  profileNameFor?: (profileId: string) => string;
  onAddFile: BetaAudioAttachmentSink;
  onReturnToProfile?: (profileId: string) => void;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(3)} MiB`;
}

function exactBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} B`;
}

function formatLimit(limit: 'duration' | 'bytes', value: number): string {
  return limit === 'duration'
    ? formatDuration(value)
    : formatBytes(value);
}

function ActionTooltip({ label, children }: { label: string; children: ReactElement }) {
  return <Tooltip content={label}>{children}</Tooltip>;
}

export function BetaAudioRecorder({ controller, profileId, profileName, profileNameFor, onAddFile, onReturnToProfile }: BetaAudioRecorderProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const [discardOpen, setDiscardOpen] = useState(false);
  const phase = snapshot.phase;
  const boundProfileName = snapshot.profileId
    ? profileNameFor?.(snapshot.profileId) || (snapshot.profileId === profileId ? profileName : undefined) || snapshot.profileId
    : profileName || profileId;
  const scopeMismatch = !!snapshot.profileId && snapshot.profileId !== profileId;
  const nearDurationLimit = phase === 'recording'
    && snapshot.durationMs >= controller.limits.maxDurationMs * controller.limits.warningRatio;
  const nearByteLimit = phase === 'recording'
    && snapshot.byteLength >= controller.limits.maxBytes * controller.limits.warningRatio;
  const pendingFile = phase === 'awaiting_attachment' && !scopeMismatch
    ? controller.getPendingFile(profileId)
    : null;

  const confirmDiscard = () => {
    if (snapshot.profileId) controller.discard(snapshot.profileId);
    setDiscardOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="beta-audio-recorder">
      {(phase === 'idle' || phase === 'recording') && (
        <ActionTooltip label={phase === 'recording' ? '停止并保留原声' : '开始原声录音'}>
          <Button
            type="button" size="icon" variant="ghost"
            className={`h-9 w-9 shrink-0 rounded-full [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${phase === 'recording' ? 'text-destructive hover:text-destructive' : 'text-muted hover:text-foreground'}`}
            aria-label={phase === 'recording' ? '停止原声录音' : '开始原声录音'}
            onClick={() => {
              if (phase === 'recording') void controller.stop();
              else void controller.start(profileId).catch(() => {});
            }}
          >
            {phase === 'recording' ? <Square size={16} className="fill-current" /> : <Mic size={16} />}
          </Button>
        </ActionTooltip>
      )}

      {phase === 'requesting_permission' && (
        <div className="flex min-w-0 items-center gap-2" role="status" aria-live="polite">
          <LoaderCircle size={15} className="shrink-0 animate-spin text-brand-accent" />
          <span className="text-xs text-secondary">正在请求麦克风许可</span>
          {snapshot.profileId && <Button type="button" size="sm" variant="ghost" onClick={() => controller.cancelStartup(snapshot.profileId!)}>取消档案 {boundProfileName} 的请求</Button>}
        </div>
      )}

      {phase === 'recording' && (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="beta-audio-recording-status">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive" role="status" aria-live="off">
            <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
            正在录音
          </span>
          {scopeMismatch && <span className="text-xs text-secondary">属于档案 {boundProfileName}</span>}
          <span className="min-w-[4.5ch] font-mono text-xs tabular-nums text-foreground" aria-label="已录制时长" data-testid="beta-audio-duration">
            {formatDuration(snapshot.durationMs)}
          </span>
          <span className="min-w-[5.5ch] font-mono text-xs tabular-nums text-muted" aria-label="已收集原声字节" data-testid="beta-audio-bytes">
            <Tooltip content={exactBytes(snapshot.byteLength)}><span  tabIndex={0}>{formatBytes(snapshot.byteLength)}</span></Tooltip>
          </span>
          {(nearDurationLimit || nearByteLimit) && (
            <span className="text-[11px] text-secondary" role="status">
              接近 {nearByteLimit ? formatLimit('bytes', controller.limits.maxBytes) : formatLimit('duration', controller.limits.maxDurationMs)} 上限
            </span>
          )}
          <DiscardDialog
            open={discardOpen}
            onOpenChange={setDiscardOpen}
            onConfirm={confirmDiscard}
            target={boundProfileName}
          />
        </div>
      )}

      {phase === 'stopping' && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-secondary" role="status" aria-live="polite">
          <LoaderCircle size={15} className="shrink-0 animate-spin" />
          <span>正在收束原声</span>
          <Tooltip content={exactBytes(snapshot.byteLength)}><span className="font-mono tabular-nums"  tabIndex={0}>{formatDuration(snapshot.durationMs)} · {formatBytes(snapshot.byteLength)}</span></Tooltip>
        </div>
      )}

      {phase === 'awaiting_attachment' && (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="beta-audio-pending-status">
          <Tooltip content={snapshot.fileName ?? undefined}><span className="min-w-0 max-w-48 truncate text-xs font-medium text-foreground"  tabIndex={0}>
            原声待保存到草稿
          </span></Tooltip>
          <Tooltip content={exactBytes(snapshot.byteLength)}><span className="font-mono text-xs tabular-nums text-muted"  tabIndex={0}>
            {formatDuration(snapshot.durationMs)} · {formatBytes(snapshot.byteLength)}
          </span></Tooltip>
          {scopeMismatch && (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <span className="text-xs text-secondary">属于档案 {boundProfileName}；请回到该档案继续保存</span>
              {snapshot.profileId && onReturnToProfile && <Button type="button" size="sm" variant="outline" onClick={() => onReturnToProfile(snapshot.profileId!)}>返回档案 {boundProfileName}</Button>}
            </div>
          )}
          {!scopeMismatch && (
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => { void controller.accept(profileId, onAddFile).catch(() => {}); }}
              aria-label={snapshot.error ? '重试保存原声到草稿' : '保存原声到草稿'}
            >
              <Paperclip size={14} className="mr-1.5" />{snapshot.error ? '重试保存' : '保存到草稿'}
            </Button>
          )}
          <DiscardDialog
            open={discardOpen}
            onOpenChange={setDiscardOpen}
            onConfirm={confirmDiscard}
            target={boundProfileName}
          />
          <div className="basis-full">
            {snapshot.limitReached === 'duration' && (
              <p className="text-[11px] text-secondary" role="status">已到 {formatLimit('duration', controller.limits.maxDurationMs)} 默认时长上限，录音已停止。</p>
            )}
            {snapshot.limitReached === 'bytes' && (
              <p className="text-[11px] text-destructive" role="alert">已到 {formatLimit('bytes', controller.limits.maxBytes)} 默认字节上限；保留的片段可能不完整。</p>
            )}
            {snapshot.partial && !snapshot.limitReached && (
              <p className="text-[11px] text-destructive" role="alert">录音器报告编码异常；原声片段已保留，但完整性未知。</p>
            )}
            {snapshot.error && <p className="text-[11px] text-destructive" role="alert">{snapshot.error}</p>}
          </div>
          {pendingFile && snapshot.sourceId && (
            <div className="basis-full min-w-0">
              <BetaMediaPreview
                identity={JSON.stringify([profileId, snapshot.sourceId, pendingFile.name, pendingFile.size, pendingFile.type])}
                sourceScope={controller}
                inline
                durationHintMs={snapshot.durationMs}
                fileName={pendingFile.name}
                mediaType={pendingFile.type || snapshot.mimeType || 'application/octet-stream'}
                byteLength={pendingFile.size}
                fallbackActionMessage="关闭试听后可继续保存这段原声"
                load={async () => {
                  const current = controller.getPendingFile(profileId);
                  if (!current || current !== pendingFile) throw new Error('原声已变化；关闭试听后重新打开即可查看当前录音');
                  return current;
                }}
              />
            </div>
          )}
        </div>
      )}

      {phase === 'attaching' && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-secondary" role="status" aria-live="polite">
          <LoaderCircle size={15} className="shrink-0 animate-spin" />
          <span>正在保存到记录草稿</span>
          <Tooltip content={exactBytes(snapshot.byteLength)}><span className="font-mono tabular-nums"  tabIndex={0}>{formatDuration(snapshot.durationMs)} · {formatBytes(snapshot.byteLength)}</span></Tooltip>
        </div>
      )}

      {phase === 'failed' && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="max-w-[min(24rem,75vw)] text-xs text-destructive" role="alert">{snapshot.error}</p>
          {snapshot.byteLength > 0 && snapshot.fileName === null && (
            <Button type="button" size="sm" variant="outline" onClick={() => controller.retryFileAssembly()}>
              重试封装原声
            </Button>
          )}
          {snapshot.profileId && snapshot.byteLength > 0 && (
            <DiscardDialog
              open={discardOpen}
              onOpenChange={setDiscardOpen}
              onConfirm={confirmDiscard}
              target={boundProfileName}
            />
          )}
          {scopeMismatch && snapshot.profileId && onReturnToProfile && (
            <Button type="button" size="sm" variant="outline" onClick={() => onReturnToProfile(snapshot.profileId!)}>返回档案 {boundProfileName}</Button>
          )}
          {snapshot.byteLength === 0 && !scopeMismatch && (
            <Button type="button" size="sm" variant="outline" onClick={() => { void controller.start(profileId).catch(() => {}); }}>
              重新录音
            </Button>
          )}
          {snapshot.byteLength === 0 && scopeMismatch && <span className="text-xs text-secondary">切回档案 {boundProfileName} 后可以重试。</span>}
        </div>
      )}
    </div>
  );
}

function DiscardDialog({
  open, onOpenChange, onConfirm, target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  target: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionTooltip label="放弃原声录音">
          <Button
            type="button" size="icon" variant="ghost"
            className="h-9 w-9 shrink-0 rounded-full text-muted hover:text-destructive [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            aria-label="放弃原声录音"
            onClick={() => onOpenChange(true)}
          >
            <Trash2 size={15} />
          </Button>
      </ActionTooltip>
      <DialogContent className="border-border-card bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle>放弃原声录音？</DialogTitle>
          <DialogDescription>
            {target ? `这段原声属于档案 ${target}。` : ''}放弃后将清除当前控制器保留的录音字节，此操作无法恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>继续保留</Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>明确放弃</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
