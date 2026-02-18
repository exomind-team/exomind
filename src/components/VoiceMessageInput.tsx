/**
 * VoiceMessageInput - 语音消息输入框
 *
 * ┌─────────────────────────────────────────┐
 * │  L4 UI                                  │
 * │  ─────────────────────────────────     │
 * │  - 文本输入框                           │
 * │  - 发送按钮                             │
 * │  - 语音输入按钮（可选集成）               │
 * │  - 支持 ASR 适配器注入                   │
 * └─────────────────────────────────────────┘
 */

import { useState, KeyboardEvent, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { VoiceInputButton, type VoiceInputButtonHandle } from '@/components/VoiceInputButton';
import type { IASRPort, IASRConfig } from '@/lib/ports/asr-port';

export interface VoiceMessageInputProps {
  /** 发送消息回调 */
  onSend: (content: string) => void;
  /** 语音识别结果回调（可选，用于自定义处理） */
  onVoiceResult?: (text: string) => void;
  /** 占位符 */
  placeholder?: string;
  /** ASR 适配器 */
  adapter?: IASRPort;
  /** 适配器配置 */
  adapterConfig?: IASRConfig;
  /** 是否显示波形 */
  showWaveform?: boolean;
  /** 是否显示计时器 */
  showTimer?: boolean;
  /** 启用快捷键 */
  enableShortcut?: boolean;
  /** 输入框类名 */
  inputClassName?: string;
  /** 按钮大小 */
  buttonSize?: number;
  /** 输入框最小行数 */
  minRows?: number;
  /** 输入框最大行数（超过后内部滚动） */
  maxRows?: number;
}

export interface VoiceMessageInputHandle {
  focusText: () => void;
  startVoiceRecording: () => void;
}

export const VoiceMessageInput = forwardRef<VoiceMessageInputHandle, VoiceMessageInputProps>(function VoiceMessageInput({
  onSend,
  onVoiceResult,
  placeholder = '输入消息...',
  adapter,
  adapterConfig,
  showWaveform = true,
  showTimer = true,
  enableShortcut = true,
  inputClassName,
  buttonSize = 40,
  minRows = 2,
  maxRows = 6,
}: VoiceMessageInputProps, ref) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const voiceButtonRef = useRef<VoiceInputButtonHandle | null>(null);

  const resizeTextarea = useCallback((target?: HTMLTextAreaElement | null) => {
    const el = target ?? textareaRef.current;
    if (!el) return;

    const computed = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
    const vertical = paddingTop + paddingBottom + borderTop + borderBottom;
    const minHeight = Math.ceil(lineHeight * minRows + vertical);
    const maxHeight = Math.ceil(lineHeight * maxRows + vertical);

    el.style.height = 'auto';
    const nextHeight = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxRows, minRows]);

  useEffect(() => {
    resizeTextarea();
  }, [value, resizeTextarea]);

  // 发送消息
  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onSend(trimmed);
      setValue('');
    }
  }, [value, onSend]);

  // 键盘事件
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      textareaRef.current?.blur();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        handleSend();
      } else {
        textareaRef.current?.blur();
        voiceButtonRef.current?.start();
      }
    }
  };

  // 语音识别结果
  const handleVoiceResult = useCallback((text: string) => {
    // 追加到输入框
    setValue(prev => (prev.trim() ? `${prev} ${text}` : text));
    // 触发回调（如果有）
    onVoiceResult?.(text);
  }, [onVoiceResult]);

  // 语音状态变化
  const handleStateChange = useCallback(() => {
    // 可以在这里添加状态提示
  }, []);

  useImperativeHandle(ref, () => ({
    focusText: () => {
      textareaRef.current?.focus();
    },
    startVoiceRecording: () => {
      voiceButtonRef.current?.start();
    },
  }), []);

  return (
    <div className="flex items-end gap-2 px-3 py-2 border-t bg-card shrink-0 safe-area-pb">
      {/* 语音输入按钮 */}
      <VoiceInputButton
        ref={voiceButtonRef}
        onResult={handleVoiceResult}
        onStateChange={handleStateChange}
        adapter={adapter}
        adapterConfig={adapterConfig}
        showWaveform={showWaveform}
        showTimer={showTimer}
        enableShortcut={enableShortcut}
        size={buttonSize}
        style={{
          flexShrink: 0,
        }}
      />

      {/* 文本输入框 */}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          resizeTextarea(e.target);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
        rows={minRows}
        data-testid="event-input-textarea"
        data-gramm="false"
        spellCheck={false}
        style={{
          flex: 1,
          minHeight: '56px',
        }}
      />

      {/* 发送按钮 */}
      <Button
        onClick={handleSend}
        disabled={!value.trim()}
        size="icon"
        className="shrink-0"
        type="button"
        data-testid="event-send-button"
      >
        <Send size={18} />
      </Button>
    </div>
  );
});
