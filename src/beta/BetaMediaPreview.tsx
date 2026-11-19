import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Music2, Pause, Play, Video, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from './drafts';
import { evaluateMediaPreview, formatMediaTime, resolveMediaPreviewFormat, type MediaPreviewPlan } from './media-preview';

type PlaybackStatus = 'idle' | 'starting' | 'playing' | 'buffering' | 'paused' | 'ended' | 'error';
type PreviewOwner = { identity: string; sourceScope?: object; active: boolean; url?: string; media?: HTMLMediaElement };
type PreviewState = {
  identity: string;
  sourceScope?: object;
  status: 'idle' | 'loading' | 'ready' | 'error';
  owner?: PreviewOwner;
  metadataRead: boolean;
  duration: number | null;
  currentTime: number;
  volume: number;
  playback: PlaybackStatus;
  error?: string;
};
type PreviewScope = { identity: string; sourceScope?: object };

// The shared UI package has no Slider primitive. Keep native range semantics
// local to this feature while removing the browser appearance and using theme tokens.
const RANGE_CLASS = [
  'h-8 w-full cursor-pointer appearance-none bg-transparent [@media(pointer:coarse)]:h-11',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
  'disabled:cursor-not-allowed disabled:opacity-50',
  '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-border-page',
  '[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border-subtle [&::-webkit-slider-thumb]:bg-brand-accent',
  '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-border-page',
  '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-border-subtle [&::-moz-range-thumb]:bg-brand-accent',
].join(' ');

function emptyPreviewState(identity: string, sourceScope?: object): PreviewState {
  return { identity, sourceScope, status: 'idle', metadataRead: false, duration: null, currentTime: 0, volume: 1, playback: 'idle' };
}

function browserCanPlayType(mimeType: string, kind: 'audio' | 'video'): string {
  if (typeof document === 'undefined') return '';
  const media = kind === 'video' ? document.createElement('video') : document.createElement('audio');
  return typeof media.canPlayType === 'function' ? media.canPlayType(mimeType) : '';
}

function fallbackError(message: string, fallbackActionMessage: string): string {
  return `${message}；原件未修改。${fallbackActionMessage}`;
}

function playbackLabel(state: PreviewState): string {
  if (state.playback === 'starting') return '正在启动或等待媒体…';
  if (state.playback === 'playing') return '正在播放';
  if (state.playback === 'buffering') return '正在缓冲，等待媒体…';
  if (state.playback === 'paused') return '已暂停';
  if (state.playback === 'ended') return '播放结束';
  if (state.playback === 'error') return '播放未能继续';
  if (!state.metadataRead) return '正在读取媒体信息…';
  if (state.duration === null) return '已读取媒体信息；时长未确认，尚未播放';
  return '已读取媒体信息；尚未开始播放';
}

/** Explicit preview of a complete, locally verified media original. This view owns only its Blob URL. */
export function BetaMediaPreview({ identity, sourceScope, visible = true, fileName, mediaType, byteLength, fallbackActionMessage = '关闭后可使用系统打开或下载原件', load }: {
  identity: string;
  sourceScope?: object;
  visible?: boolean;
  fileName: string;
  mediaType: string;
  byteLength: number;
  fallbackActionMessage?: string;
  load: () => Promise<Blob>;
}) {
  const reactId = useId();
  const seekId = `beta-media-seek-${reactId}`;
  const seekReasonId = `beta-media-seek-reason-${reactId}`;
  const volumeId = `beta-media-volume-${reactId}`;
  const loader = useRef(load);
  loader.current = load;
  const fallbackActions = useRef(fallbackActionMessage);
  fallbackActions.current = fallbackActionMessage;
  const trigger = useRef<HTMLButtonElement>(null);
  const mediaElement = useRef<HTMLMediaElement | null>(null);
  const ownerRef = useRef<PreviewOwner | null>(null);
  const openScope = useRef<PreviewScope | null>(null);
  const playbackOwner = useRef<{ owner: PreviewOwner; status: PlaybackStatus } | null>(null);
  const playRequest = useRef<{ owner: PreviewOwner } | null>(null);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<PreviewState>(() => emptyPreviewState(identity, sourceScope));
  const context = useRef({ identity, sourceScope, visible, open: false });
  context.current = { identity, sourceScope, visible, open: open && visible };
  const lastScope = useRef({ identity, sourceScope, visible, fileName, mediaType, byteLength });
  const format = useMemo(() => resolveMediaPreviewFormat(fileName, mediaType), [fileName, mediaType]);
  const plan = useMemo<MediaPreviewPlan>(() => {
    return evaluateMediaPreview({
      fileName,
      mediaType,
      byteLength,
      canPlayType: mimeType => format ? browserCanPlayType(mimeType, format.kind) : '',
    });
  }, [fileName, mediaType, byteLength, format]);
  const canCreateObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  const previewAvailable = plan.kind === 'supported' && canCreateObjectUrl;
  const unavailableMessage = plan.kind === 'supported' && !canCreateObjectUrl
    ? `此环境暂未接入本机音视频预览；${fallbackActionMessage}`
    : plan.kind === 'supported' ? '' : `${plan.message}；${fallbackActionMessage}`;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const owns = useCallback((owner: PreviewOwner, element?: HTMLMediaElement): boolean => {
    return ownerRef.current === owner
      && owner.active
      && context.current.open
      && context.current.visible
      && context.current.identity === owner.identity
      && context.current.sourceScope === owner.sourceScope
      && (!element || !!owner.url && element.getAttribute('src') === owner.url);
  }, []);

  const releaseOwner = useCallback((owner: PreviewOwner | null): void => {
    if (!owner || !owner.active) return;
    owner.active = false;
    if (ownerRef.current === owner) ownerRef.current = null;
    if (playbackOwner.current?.owner === owner) playbackOwner.current = null;
    if (playRequest.current?.owner === owner) playRequest.current = null;
    const url = owner.url;
    if (!url) return;

    const element = owner.media?.getAttribute('src') === url
      ? owner.media
      : mediaElement.current?.getAttribute('src') === url ? mediaElement.current : null;
    if (element?.getAttribute('src') === url) {
      try { element.pause(); } catch { /* A detached media element can reject cleanup. */ }
      element.removeAttribute('src');
      try { element.load(); } catch { /* Removing the local source is already authoritative. */ }
    }
    owner.url = undefined;
    owner.media = undefined;
    URL.revokeObjectURL(url);
  }, []);

  const updateOwnedPreview = useCallback((owner: PreviewOwner, update: (current: PreviewState) => PreviewState): void => {
    if (!owns(owner)) return;
    setPreview(current => current.owner === owner && owns(owner) ? update(current) : current);
  }, [owns]);

  const updatePlayback = useCallback((owner: PreviewOwner, playback: PlaybackStatus, error?: string): void => {
    if (!owns(owner)) return;
    if (playback !== 'starting' && playback !== 'buffering' && playRequest.current?.owner === owner) playRequest.current = null;
    playbackOwner.current = { owner, status: playback };
    updateOwnedPreview(owner, current => ({ ...current, playback, error }));
  }, [owns, updateOwnedPreview]);

  function closePreview(): void {
    context.current.open = false;
    releaseOwner(ownerRef.current);
    setOpen(false);
    setPreview(emptyPreviewState(identity, sourceScope));
  }

  function changeOpen(nextOpen: boolean): void {
    if (nextOpen) {
      openScope.current = { identity, sourceScope };
      context.current.open = context.current.visible;
      setPreview({ ...emptyPreviewState(identity, sourceScope), status: 'loading' });
      setOpen(true);
    } else {
      closePreview();
    }
  }

  useLayoutEffect(() => {
    const previous = lastScope.current;
    const changed = previous.identity !== identity || previous.sourceScope !== sourceScope
      || previous.fileName !== fileName || previous.mediaType !== mediaType || previous.byteLength !== byteLength;
    const becameHidden = previous.visible && !visible;
    if (changed || becameHidden) {
      context.current.open = false;
      releaseOwner(ownerRef.current);
      openScope.current = null;
      setOpen(false);
      setPreview(emptyPreviewState(identity, sourceScope));
    }
    lastScope.current = { identity, sourceScope, visible, fileName, mediaType, byteLength };
  }, [identity, sourceScope, visible, fileName, mediaType, byteLength, releaseOwner]);

  useLayoutEffect(() => () => releaseOwner(ownerRef.current), [releaseOwner]);

  useEffect(() => {
    // A layout-effect scope change can close this preview before the passive
    // effect from the same render runs. Do not read the replacement's original.
    if (!open || !visible || !context.current.open || !previewAvailable || plan.kind !== 'supported') return;

    const owner: PreviewOwner = { identity, sourceScope, active: true };
    ownerRef.current = owner;
    playbackOwner.current = { owner, status: 'idle' };
    setPreview({ ...emptyPreviewState(identity, sourceScope), status: 'loading', owner });
    const read = loader.current;

    void (async () => {
      try {
        const blob = await read();
        if (!owns(owner)) return;
        if (blob.size !== byteLength) throw new Error('原件长度与记录不一致；未附加媒体源');

        const url = URL.createObjectURL(blob);
        if (!owns(owner)) {
          URL.revokeObjectURL(url);
          return;
        }
        owner.url = url;
        setPreview({ ...emptyPreviewState(identity, sourceScope), status: 'ready', owner });
      } catch (failure) {
        if (!owns(owner)) return;
        playbackOwner.current = { owner, status: 'error' };
        setPreview({
          ...emptyPreviewState(identity, sourceScope),
          status: 'error',
          owner,
          playback: 'error',
          error: fallbackError(errorMessage(failure), fallbackActions.current),
        });
      }
    })();

    return () => releaseOwner(owner);
  }, [open, visible, previewAvailable, plan.kind, identity, sourceScope, fileName, mediaType, byteLength, revision, owns, releaseOwner]);

  if (plan.kind === 'unsupported-format') return null;

  const bound = preview.identity === identity && preview.sourceScope === sourceScope && visible ? preview : null;
  const readyState = plan.kind === 'supported' && bound?.status === 'ready' && bound.owner?.url ? bound : null;
  const owner = readyState?.owner;
  const playbackActive = readyState?.playback === 'playing' || readyState?.playback === 'starting' || readyState?.playback === 'buffering';
  const duration = readyState?.duration ?? null;
  const maximumSeek = duration !== null && duration > 0 ? duration : 1;
  const seekDisabled = !readyState || !readyState.metadataRead || duration === null || duration <= 0;
  const seekDisabledReason = !readyState?.metadataRead
    ? '时长尚未读取，无法定位'
    : duration === 0
      ? '原件时长为 0 秒，无法定位'
      : '浏览器未提供可定位的有限时长';

  function onLoadedMetadata(currentOwner: PreviewOwner, element: HTMLMediaElement): void {
    if (!owns(currentOwner, element)) return;
    const nextDuration = Number.isFinite(element.duration) && element.duration >= 0 ? element.duration : null;
    updateOwnedPreview(currentOwner, current => ({
      ...current,
      metadataRead: true,
      duration: nextDuration,
      currentTime: Number.isFinite(element.currentTime) && element.currentTime >= 0 ? element.currentTime : 0,
    }));
  }

  function onTimeUpdate(currentOwner: PreviewOwner, element: HTMLMediaElement): void {
    if (!owns(currentOwner, element) || !Number.isFinite(element.currentTime) || element.currentTime < 0) return;
    updateOwnedPreview(currentOwner, current => ({ ...current, currentTime: element.currentTime }));
  }

  function onPause(currentOwner: PreviewOwner, element: HTMLMediaElement): void {
    if (!owns(currentOwner, element)) return;
    if (playRequest.current?.owner === currentOwner) playRequest.current = null;
    const status = playbackOwner.current?.owner === currentOwner ? playbackOwner.current.status : 'idle';
    if (status !== 'ended' && status !== 'error') updatePlayback(currentOwner, 'paused');
  }

  function onMediaError(currentOwner: PreviewOwner, element: HTMLMediaElement): void {
    if (!owns(currentOwner, element)) return;
    updatePlayback(currentOwner, 'error', fallbackError('浏览器无法解码此媒体', fallbackActions.current));
  }

  function onPlay(currentOwner: PreviewOwner, element: HTMLMediaElement): void {
    if (owns(currentOwner, element)) updatePlayback(currentOwner, 'starting');
  }

  function onPlaying(currentOwner: PreviewOwner, element: HTMLMediaElement): void {
    if (owns(currentOwner, element)) updatePlayback(currentOwner, 'playing');
  }

  function onWaiting(currentOwner: PreviewOwner, element: HTMLMediaElement): void {
    if (!owns(currentOwner, element)) return;
    const playback = playbackOwner.current?.owner === currentOwner ? playbackOwner.current.status : 'idle';
    if (playback === 'starting' || playback === 'playing' || playback === 'buffering') updatePlayback(currentOwner, 'buffering');
  }

  function startPlayback(currentOwner: PreviewOwner): void {
    const element = mediaElement.current;
    if (!element || !owns(currentOwner, element)) return;
    const request = { owner: currentOwner };
    playRequest.current = request;
    updatePlayback(currentOwner, 'starting');
    try {
      void Promise.resolve(element.play()).catch(failure => {
        if (playRequest.current === request && owns(currentOwner, element)) {
          playRequest.current = null;
          updatePlayback(currentOwner, 'error', fallbackError(`浏览器未能开始播放：${errorMessage(failure)}`, fallbackActions.current));
        }
      });
    } catch (failure) {
      updatePlayback(currentOwner, 'error', fallbackError(`浏览器未能开始播放：${errorMessage(failure)}`, fallbackActions.current));
    }
  }

  function pausePlayback(currentOwner: PreviewOwner): void {
    const element = mediaElement.current;
    if (!element || !owns(currentOwner, element)) return;
    if (playRequest.current?.owner === currentOwner) playRequest.current = null;
    try {
      element.pause();
      updatePlayback(currentOwner, 'paused');
    } catch {
      updatePlayback(currentOwner, 'error', fallbackError('浏览器未能暂停播放', fallbackActions.current));
    }
  }

  function seek(currentOwner: PreviewOwner, event: ChangeEvent<HTMLInputElement>): void {
    const element = mediaElement.current;
    const requestedTime = Number(event.currentTarget.value);
    const currentState = previewRef.current;
    if (!element || !owns(currentOwner, element) || !Number.isFinite(requestedTime)
      || currentState.owner !== currentOwner || currentState.duration === null || currentState.duration <= 0) return;
    try {
      element.currentTime = Math.max(0, Math.min(currentState.duration, requestedTime));
      updateOwnedPreview(currentOwner, current => ({ ...current, currentTime: element.currentTime }));
    } catch {
      updateOwnedPreview(currentOwner, current => ({ ...current, error: fallbackError('浏览器无法定位到所选时间', fallbackActions.current) }));
    }
  }

  function changeVolume(currentOwner: PreviewOwner, event: ChangeEvent<HTMLInputElement>): void {
    const element = mediaElement.current;
    const requestedVolume = Number(event.currentTarget.value);
    if (!element || !owns(currentOwner, element) || !Number.isFinite(requestedVolume)) return;
    const volume = Math.max(0, Math.min(100, requestedVolume)) / 100;
    try {
      element.volume = volume;
      updateOwnedPreview(currentOwner, current => ({ ...current, volume }));
    } catch {
      updateOwnedPreview(currentOwner, current => ({ ...current, error: fallbackError('浏览器无法调整音量', fallbackActions.current) }));
    }
  }

  function bindMediaElement(currentOwner: PreviewOwner, element: HTMLMediaElement | null): void {
    if (element) {
      mediaElement.current = element;
      currentOwner.media = element;
    } else if (mediaElement.current === currentOwner.media) {
      mediaElement.current = null;
    }
  }

  const openDialog = open && visible;
  return <>
    <Button
      ref={trigger}
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 shrink-0 px-2 text-xs [@media(pointer:coarse)]:h-11"
      aria-label={`预览${format?.kind === 'audio' ? '音频' : format?.kind === 'video' ? '视频' : '音视频'} ${fileName}`}
      aria-haspopup="dialog"
      aria-expanded={openDialog}
      disabled={!visible || !previewAvailable}
      onClick={() => changeOpen(true)}
    >
      {format?.kind === 'video' ? <Video size={14} aria-hidden="true" /> : <Music2 size={14} aria-hidden="true" />}
      预览{format?.kind === 'video' ? '视频' : '音频'}
    </Button>
    {unavailableMessage && <p role="status" className="max-w-sm text-xs text-muted">{unavailableMessage}</p>}
    <Dialog open={openDialog} onOpenChange={changeOpen}>
      <DialogContent
        closeButtonClassName="right-0.5 top-0.5 inline-flex h-11 w-11 items-center justify-center"
        className="beta-ui max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl border-border-page bg-surface text-foreground sm:rounded-2xl"
        onCloseAutoFocus={event => {
          event.preventDefault();
          const opened = openScope.current;
          openScope.current = null;
          if (visible && opened && context.current.identity === opened.identity && context.current.sourceScope === opened.sourceScope) {
            trigger.current?.focus({ preventScroll: true });
          }
        }}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="break-all text-base">{fileName}</DialogTitle>
          <DialogDescription>{`只读${plan.kind === 'supported' && plan.format.kind === 'video' ? '视频' : '音频'}预览 · 原件保持不变`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {bound?.status === 'loading' && <p role="status" className="text-sm text-muted">正在读取并校验本机原件…</p>}
          {bound?.status === 'error' && <div role="group" aria-label="媒体预览失败" className="space-y-3">
            <p role="alert" className="text-sm text-destructive">{bound.error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>重试预览</Button>
          </div>}
          {readyState && owner && <>
            {plan.kind === 'supported' && plan.format.kind === 'video'
              ? <video
                  ref={element => bindMediaElement(owner, element)}
                  data-testid="beta-media-element"
                  aria-label={`视频原件 ${fileName}`}
                  className="aspect-video max-h-[60dvh] w-full rounded-xl border border-border-page bg-surface object-contain"
                  src={owner.url}
                  controls={false}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={event => onLoadedMetadata(owner, event.currentTarget)}
                  onTimeUpdate={event => onTimeUpdate(owner, event.currentTarget)}
                  onPlay={event => onPlay(owner, event.currentTarget)}
                  onPlaying={event => onPlaying(owner, event.currentTarget)}
                  onWaiting={event => onWaiting(owner, event.currentTarget)}
                  onPause={event => onPause(owner, event.currentTarget)}
                  onEnded={event => {
                    if (!owns(owner, event.currentTarget)) return;
                    updatePlayback(owner, 'ended');
                    onTimeUpdate(owner, event.currentTarget);
                  }}
                  onError={event => onMediaError(owner, event.currentTarget)}
                />
              : <div className="flex min-h-8 items-center gap-2 text-xs text-muted">
                  <Music2 size={16} className="shrink-0 text-brand-accent" aria-hidden="true" />
                  <span>本机音频原件</span>
                  <audio
                    ref={element => bindMediaElement(owner, element)}
                    data-testid="beta-media-element"
                    aria-label={`音频原件 ${fileName}`}
                    className="sr-only"
                    src={owner.url}
                    controls={false}
                    preload="metadata"
                    onLoadedMetadata={event => onLoadedMetadata(owner, event.currentTarget)}
                    onTimeUpdate={event => onTimeUpdate(owner, event.currentTarget)}
                    onPlay={event => onPlay(owner, event.currentTarget)}
                    onPlaying={event => onPlaying(owner, event.currentTarget)}
                    onWaiting={event => onWaiting(owner, event.currentTarget)}
                    onPause={event => onPause(owner, event.currentTarget)}
                    onEnded={event => {
                      if (!owns(owner, event.currentTarget)) return;
                      updatePlayback(owner, 'ended');
                      onTimeUpdate(owner, event.currentTarget);
                    }}
                    onError={event => onMediaError(owner, event.currentTarget)}
                  />
                </div>}

            <div className="flex min-h-6 items-center justify-between gap-3 text-xs text-secondary" role="group" aria-label="媒体播放状态">
              <p data-testid="beta-media-playback-status" role="status" aria-live="polite" className="min-w-0 truncate">{playbackLabel(readyState)}</p>
              <p data-testid="beta-media-time" className="shrink-0 font-mono tabular-nums" aria-live="off">
                <span className="sr-only">当前时间 </span><time>{formatMediaTime(readyState.currentTime)}</time>
                <span aria-hidden="true"> / </span>
                <span className="sr-only">总时长 </span><time>{formatMediaTime(readyState.duration)}</time>
              </p>
            </div>

            {readyState.error && <p role="alert" className="text-xs text-destructive">{readyState.error}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="[@media(pointer:coarse)]:h-11"
                aria-label={playbackActive ? '暂停' : '播放'}
                onClick={() => {
                  if (playbackActive) pausePlayback(owner);
                  else startPlayback(owner);
                }}
              >
                {playbackActive ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                {playbackActive ? '暂停' : '播放'}
              </Button>
              <div className="min-w-0 flex-[1_1_15rem] space-y-1">
                <label htmlFor={seekId} className="flex items-center justify-between gap-3 text-xs text-secondary">
                  <span>播放位置 <span className="text-muted">（秒）</span></span>
                </label>
                <input
                  id={seekId}
                  type="range"
                  tabIndex={0}
                  min={0}
                  max={maximumSeek}
                  step={0.1}
                  value={Math.min(readyState.currentTime, maximumSeek)}
                  disabled={seekDisabled}
                  aria-label="播放位置（秒）"
                  aria-valuetext={`${Math.floor(readyState.currentTime)} 秒`}
                  aria-describedby={seekDisabled ? seekReasonId : undefined}
                  className={RANGE_CLASS}
                  onChange={event => seek(owner, event)}
                />
                {seekDisabled && <p id={seekReasonId} className="text-[11px] text-muted">{seekDisabledReason}</p>}
              </div>
              <div className="flex min-w-32 flex-[0_1_10rem] items-center gap-2">
                <label htmlFor={volumeId} className="flex shrink-0 items-center gap-1 text-xs text-secondary">
                  <Volume2 size={14} aria-hidden="true" />
                  <span className="sr-only">音量</span>
                </label>
                <input
                  id={volumeId}
                  type="range"
                  tabIndex={0}
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(readyState.volume * 100)}
                  aria-label="音量（百分比）"
                  aria-valuetext={`${Math.round(readyState.volume * 100)}%`}
                  className={RANGE_CLASS}
                  onChange={event => changeVolume(owner, event)}
                />
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted">{Math.round(readyState.volume * 100)}%</span>
              </div>
            </div>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
