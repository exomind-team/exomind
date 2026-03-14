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
import { toast } from '@/components/ui/toast-hook';
import { publishVoiceTranscriptSignal } from '@/lib/services/voice-signal.service';
import { log } from '@/lib/logger';

export interface VoiceMessageInputProps {
  /** 发送消息回调 */
  onSend: (content: string) => void | Promise<void>;
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
  /** UI 变体（UI Variant） */
  variant?: 'default' | 'new-mobile';
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
  variant = 'default',
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
  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed) {
      const saved = value;
      setValue('');
      try {
        await onSend(trimmed);
      } catch (error) {
        setValue(saved);
        log.error(`[VoiceMessageInput] send failed: ${error instanceof Error ? error.message : String(error)}`);
        toast({ title: '发送失败', description: '请检查网络连接后重试', variant: 'destructive' });
      }
    }
  }, [value, onSend]);

  // 键盘事件
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      textareaRef.current?.blur();
      return;
    }

    if (e.key !== 'Enter') return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.altKey || e.shiftKey) return;

    e.preventDefault();
    if (value.trim()) {
      handleSend();
    } else {
      textareaRef.current?.blur();
      voiceButtonRef.current?.start();
    }
  };

  // 语音识别结果
  const handleVoiceResult = useCallback((text: string) => {
    const normalized = text.trim();
    if (!normalized) return;

    // 追加到输入框
    setValue(prev => (prev.trim() ? `${prev} ${normalized}` : normalized));
    // 触发回调（如果有）
    onVoiceResult?.(normalized);
    void publishVoiceTranscriptSignal({ text: normalized }, {
      source: 'frontend:voice-message-input',
    }).catch((publishError) => {
      log.warn(`[VoiceMessageInput] 发布语音信号失败（voice signal publish failed）: ${publishError instanceof Error ? publishError.message : String(publishError)}`);
    });
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

  const isNewMobile = variant === 'new-mobile';
  const wrapperClassName = isNewMobile ? 'safe-area-pb bg-transparent shrink-0' : 'safe-area-pb bg-card shrink-0';
  const rowClassName = isNewMobile
    ? 'mx-3 mb-2 mt-2 flex items-end gap-2 rounded-2xl border border-[#ECE7E2] bg-white px-2 py-2 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.45)]'
    : 'flex items-end gap-2 px-3 py-2 border-t';
  const textareaClassName = isNewMobile ? `${inputClassName ?? ''} rounded-2xl border-[#E7E5E4] bg-white` : inputClassName;
  const sendButtonClassName = isNewMobile
    ? 'shrink-0 rounded-xl bg-[#9CA3AF] hover:bg-[#7B8493] data-[disabled]:bg-[#D1D5DB]'
    : 'shrink-0';

  return (
    <div className={wrapperClassName}>
      <div className={rowClassName}>
        {/* 语音输入按钮 */}
        <VoiceInputButton
          ref={voiceButtonRef}
          onResult={handleVoiceResult}
          onStateChange={handleStateChange}
          adapter={adapter}
          adapterConfig={adapterConfig}
          showWaveform={showWaveform}
          showTimer={showTimer}
          showPermissionUnlockButton={!isNewMobile}
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
          className={textareaClassName}
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
          className={sendButtonClassName}
          type="button"
          data-testid="event-send-button"
        >
          <Send size={18} />
        </Button>
      </div>
    </div>
  );
});
