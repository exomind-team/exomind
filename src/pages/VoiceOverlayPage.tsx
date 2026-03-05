/**
 * VoiceOverlayPage - 语音输入迷你悬浮窗
 *
 * 由 Tauri 动态创建的透明无边框窗口承载。
 * 通过 Tauri event 接收状态变更指令，展示 4 种状态：
 *   recording  → 红色脉冲点 + "录音中..." + 时长
 *   recognizing → 转圈动画 + "识别中..."
 *   done       → 绿色勾 + 文本预览（前 20 字）
 *   error      → 红色叹号 + 错误信息
 *
 * Phase 1: 静态 UI 壳，使用本地 state 模拟状态切换。
 * Phase 2: 接入 Tauri event 驱动。
 */

import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Mic, LoaderCircle, Check, AlertCircle } from "lucide-react";

// --- Types ---

export type OverlayState = "idle" | "recording" | "recognizing" | "done" | "error";

interface OverlayData {
  state: OverlayState;
  /** 录音时长（秒），recording 状态使用 */
  duration: number;
  /** ASR 结果文本预览，done 状态使用 */
  text: string;
  /** 错误信息，error 状态使用 */
  errorMessage: string;
}

// --- Constants ---

const AUTO_HIDE_DONE_MS = 2000;
const AUTO_HIDE_ERROR_MS = 3000;

// --- Component ---

export function VoiceOverlayPage() {
  const [data, setData] = useState<OverlayData>({
    state: "idle",
    duration: 0,
    text: "",
    errorMessage: "",
  });

  // Listen to Tauri event from VoiceShortcutService
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    listen<Partial<OverlayData>>("voice-overlay-state", (event) => {
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

  // 录音计时器
  useEffect(() => {
    if (data.state !== "recording") return;
    const start = Date.now() - data.duration * 1000;
    const timer = setInterval(() => {
      setData((prev) => ({
        ...prev,
        duration: (Date.now() - start) / 1000,
      }));
    }, 100);
    return () => clearInterval(timer);
  }, [data.state]);

  // done / error 自动隐藏（Phase 2 将 emit hide event）
  useEffect(() => {
    if (data.state === "done") {
      const t = setTimeout(() => setData((prev) => ({ ...prev, state: "idle" })), AUTO_HIDE_DONE_MS);
      return () => clearTimeout(t);
    }
    if (data.state === "error") {
      const t = setTimeout(() => setData((prev) => ({ ...prev, state: "idle" })), AUTO_HIDE_ERROR_MS);
      return () => clearTimeout(t);
    }
  }, [data.state]);

  if (data.state === "idle") return null;

  return (
    <div className="voice-overlay-root">
      <div className={`voice-overlay voice-overlay--${data.state}`}>
        <StatusIndicator state={data.state} />
        <StatusText state={data.state} duration={data.duration} text={data.text} errorMessage={data.errorMessage} />
      </div>

      <style>{overlayStyles}</style>
    </div>
  );
}

// --- Sub-components ---

function StatusIndicator({ state }: { state: OverlayState }) {
  switch (state) {
    case "recording":
      return (
        <span className="overlay-icon overlay-icon--recording">
          <Mic size={16} />
        </span>
      );
    case "recognizing":
      return (
        <span className="overlay-icon overlay-icon--recognizing">
          <LoaderCircle size={16} />
        </span>
      );
    case "done":
      return (
        <span className="overlay-icon overlay-icon--done">
          <Check size={16} />
        </span>
      );
    case "error":
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
  duration,
  text,
  errorMessage,
}: {
  state: OverlayState;
  duration: number;
  text: string;
  errorMessage: string;
}) {
  switch (state) {
    case "recording":
      return <span className="overlay-text">{formatDuration(duration)}</span>;
    case "recognizing":
      return <span className="overlay-text overlay-text--secondary">识别中...</span>;
    case "done": {
      const preview = text.length > 20 ? text.slice(0, 20) + "..." : text;
      return <span className="overlay-text">{preview || "完成"}</span>;
    }
    case "error":
      return <span className="overlay-text overlay-text--error">{errorMessage || "识别失败"}</span>;
    default:
      return null;
  }
}

// --- Helpers ---

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// --- Styles ---

const overlayStyles = /* css */ `
  .voice-overlay-root {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 允许鼠标穿透空白区域 */
    pointer-events: none;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .voice-overlay {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-radius: 20px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
    animation: overlay-fade-in 0.15s ease-out;
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
  }

  /* --- State variants --- */

  .voice-overlay--recording {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #dc2626;
  }
  .dark .voice-overlay--recording {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.35);
    color: #f87171;
  }

  .voice-overlay--recognizing {
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    color: #2563eb;
  }
  .dark .voice-overlay--recognizing {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.3);
    color: #60a5fa;
  }

  .voice-overlay--done {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    color: #16a34a;
  }
  .dark .voice-overlay--done {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.3);
    color: #4ade80;
  }

  .voice-overlay--error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #dc2626;
  }
  .dark .voice-overlay--error {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  /* --- Icon --- */

  .overlay-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .overlay-icon--recording {
    animation: pulse-icon 1.2s ease-in-out infinite;
  }

  .overlay-icon--recognizing {
    animation: spin-icon 1s linear infinite;
  }

  .overlay-icon--done {
    animation: pop-in 0.25s ease-out;
  }

  .overlay-icon--error {
    animation: shake-icon 0.4s ease-out;
  }

  /* --- Text --- */

  .overlay-text {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .overlay-text--secondary {
    opacity: 0.8;
  }

  .overlay-text--error {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- Animations --- */

  @keyframes overlay-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse-icon {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.6; transform: scale(1.15); }
  }

  @keyframes spin-icon {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  @keyframes pop-in {
    0%   { transform: scale(0.5); opacity: 0; }
    70%  { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
  }

  @keyframes shake-icon {
    0%, 100% { transform: translateX(0); }
    20%      { transform: translateX(-3px); }
    40%      { transform: translateX(3px); }
    60%      { transform: translateX(-2px); }
    80%      { transform: translateX(2px); }
  }
`;
