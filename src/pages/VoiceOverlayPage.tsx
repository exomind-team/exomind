import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AlertCircle, Check, LoaderCircle, Mic } from 'lucide-react';
import { trimToLatestCharacters } from '@/lib/voice/overlay-text';
import {
  getVoiceShortcutHotkey,
  subscribeVoiceShortcutHotkeyChanges,
  type VoiceShortcutHotkey,
} from '@/config/voice-shortcut-hotkey';

export type OverlayState = 'idle' | 'arming' | 'recording' | 'recognizing' | 'done' | 'error';

interface OverlayData {
  state: OverlayState;
  duration: number;
  text: string;
  isLivePreview?: boolean;
  providerLabel?: string;
  recognitionMs?: number;
  errorMessage: string;
}

const AUTO_HIDE_DONE_MS = 2000;
const AUTO_HIDE_ERROR_MS = 3000;

export function VoiceOverlayPage() {
  const [shortcut, setShortcut] = useState<VoiceShortcutHotkey>(() => getVoiceShortcutHotkey());
  const [data, setData] = useState<OverlayData>({
    state: 'idle',
    duration: 0,
    text: '',
    isLivePreview: false,
    providerLabel: '',
    recognitionMs: undefined,
    errorMessage: '',
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<Partial<OverlayData>>('voice-overlay-state', (event) => {
      if (!cancelled) {
        setData((prev) => ({ ...prev, ...event.payload }));
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setShortcut(getVoiceShortcutHotkey());
    return subscribeVoiceShortcutHotkeyChanges((nextHotkey) => setShortcut(nextHotkey));
  }, []);

  useEffect(() => {
    if (data.state !== 'recording') return;
    const start = Date.now() - data.duration * 1000;
    const timer = setInterval(() => {
      setData((prev) => ({
        ...prev,
        duration: (Date.now() - start) / 1000,
      }));
    }, 100);
    return () => clearInterval(timer);
  }, [data.state, data.duration]);

  useEffect(() => {
    if (data.state === 'done') {
      const timer = setTimeout(() => setData((prev) => ({ ...prev, state: 'idle' })), AUTO_HIDE_DONE_MS);
      return () => clearTimeout(timer);
    }
    if (data.state === 'error') {
      const timer = setTimeout(() => setData((prev) => ({ ...prev, state: 'idle' })), AUTO_HIDE_ERROR_MS);
      return () => clearTimeout(timer);
    }
  }, [data.state]);

  if (data.state === 'idle') {
    return null;
  }

  return (
    <div className="voice-overlay-root">
      <div className={`voice-overlay voice-overlay--${data.state}`}>
        <StatusIndicator state={data.state} />
        <div className="overlay-content">
          <StatusText
            state={data.state}
            shortcut={shortcut}
            duration={data.duration}
            text={data.text}
            isLivePreview={data.isLivePreview}
            providerLabel={data.providerLabel}
            recognitionMs={data.recognitionMs}
            errorMessage={data.errorMessage}
          />
        </div>
      </div>
      <style>{overlayStyles}</style>
    </div>
  );
}

function StatusIndicator({ state }: { state: OverlayState }) {
  switch (state) {
    case 'arming':
      return (
        <span className="overlay-icon overlay-icon--arming">
          <LoaderCircle size={16} />
        </span>
      );
    case 'recording':
      return (
        <span className="overlay-icon overlay-icon--recording">
          <Mic size={16} />
        </span>
      );
    case 'recognizing':
      return (
        <span className="overlay-icon overlay-icon--recognizing">
          <LoaderCircle size={16} />
        </span>
      );
    case 'done':
      return (
        <span className="overlay-icon overlay-icon--done">
          <Check size={16} />
        </span>
      );
    case 'error':
      return (
        <span className="overlay-icon overlay-icon--error">
          <AlertCircle size={16} />
        </span>
      );
    default:
      return null;
  }
}

function StatusText({
  state,
  shortcut,
  duration,
  text,
  isLivePreview,
  providerLabel,
  recognitionMs,
  errorMessage,
}: {
  state: OverlayState;
  shortcut: VoiceShortcutHotkey;
  duration: number;
  text: string;
  isLivePreview?: boolean;
  providerLabel?: string;
  recognitionMs?: number;
  errorMessage: string;
}) {
  const preview = trimToLatestCharacters(text, 100);
  const providerMeta = providerLabel?.trim();

  switch (state) {
    case 'arming':
      return (
        <span className="overlay-text-group">
          <span className="overlay-text">{preview || '准备启动语音输入…'}</span>
          <span className="overlay-text overlay-text--secondary">正在连接麦克风与识别链路</span>
        </span>
      );
    case 'recording':
      return (
        <span className="overlay-text-group">
          {providerMeta ? <span className="overlay-meta">{providerMeta}</span> : null}
          <span className="overlay-text">{preview || '正在听你说…'}</span>
          <span className="overlay-status-row overlay-text overlay-text--secondary">
            <span className="overlay-duration">{formatDuration(duration)}</span>
            <span>{`${isLivePreview ? '实时预览 · ' : ''}再按 ${shortcut} 结束 · Esc 取消`}</span>
          </span>
        </span>
      );
    case 'recognizing':
      return (
        <span className="overlay-text-group">
          {providerMeta ? <span className="overlay-meta">{providerMeta}</span> : null}
          <span className="overlay-text">{preview || '识别中…'}</span>
          <span className="overlay-text overlay-text--secondary">{`识别中... · ${shortcut} 开始新一轮 · Esc 取消`}</span>
        </span>
      );
    case 'done': {
      const elapsed = typeof recognitionMs === 'number' ? formatRecognitionMs(recognitionMs) : '';
      const meta = providerMeta && elapsed
        ? `${providerMeta} · 识别 ${elapsed}`
        : elapsed
          ? `识别 ${elapsed}`
          : providerMeta || '';
      return (
        <span className="overlay-text-group">
          <span className="overlay-text">{preview || '完成'}</span>
          {meta ? <span className="overlay-text overlay-text--secondary">{meta}</span> : null}
        </span>
      );
    }
    case 'error':
      return <span className="overlay-text overlay-text--error">{errorMessage || '识别失败'}</span>;
    default:
      return null;
  }
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatRecognitionMs(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

const overlayStyles = /* css */ `
  html, body, #root {
    width: 100%;
    height: 100%;
    margin: 0;
    background: transparent !important;
    overflow: hidden;
  }

  .voice-overlay-root {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    pointer-events: none;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: transparent;
  }

  .voice-overlay {
    position: relative;
    pointer-events: auto;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    width: min(560px, calc(100vw - 16px));
    min-height: 112px;
    padding: 16px 18px;
    border-radius: 24px;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    background: linear-gradient(
      180deg,
      hsl(var(--bg-card) / 0.62),
      hsl(var(--bg-surface) / 0.46)
    );
    border: none;
    box-shadow: 0 18px 48px -28px rgba(15, 23, 42, 0.42);
    animation: overlay-fade-in 0.15s ease-out;
    font-size: 13px;
    line-height: 1.3;
    color: hsl(var(--text-primary));
  }

  .overlay-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    margin-top: 2px;
    border-radius: 999px;
    background: hsl(var(--brand-accent) / 0.14);
    color: hsl(var(--brand-accent));
  }

  .overlay-icon--recording {
    animation: pulse-icon 1.2s ease-in-out infinite;
  }

  .overlay-icon--arming {
    animation: spin-icon 1s linear infinite;
    color: hsl(var(--brand-accent));
  }

  .overlay-icon--recognizing {
    animation: spin-icon 1s linear infinite;
    color: hsl(var(--brand));
  }

  .overlay-icon--done {
    animation: pop-in 0.25s ease-out;
    color: hsl(var(--success));
  }

  .overlay-icon--error {
    animation: shake-icon 0.4s ease-out;
    color: hsl(var(--destructive));
  }

  .overlay-content {
    min-width: 0;
    text-align: left;
    align-self: center;
  }

  .overlay-meta {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: hsl(var(--text-muted));
  }

  .overlay-text {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    min-height: calc(1.45em * 2);
  }

  .overlay-text-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    flex: 1;
  }

  .overlay-text--secondary {
    opacity: 0.8;
    font-size: 11px;
    min-height: 0;
  }

  .overlay-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .overlay-duration {
    min-width: 4.4em;
    display: inline-block;
    font-variant-numeric: tabular-nums;
  }

  .overlay-text--error {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes overlay-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse-icon {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.15); }
  }

  @keyframes spin-icon {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes pop-in {
    0% { transform: scale(0.5); opacity: 0; }
    70% { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
  }

  @keyframes shake-icon {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-3px); }
    40% { transform: translateX(3px); }
    60% { transform: translateX(-2px); }
    80% { transform: translateX(2px); }
  }
`;
