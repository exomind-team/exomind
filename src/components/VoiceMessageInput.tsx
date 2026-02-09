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

import { useState, KeyboardEvent, useCallback } from 'react';
import { Send, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VoiceInputButton, type VoiceButtonState } from './VoiceInputButton';
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
}

export function VoiceMessageInput({
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
}: VoiceMessageInputProps) {
  const [value, setValue] = useState('');

  // 发送消息
  const handleSend = useCallback(() => {
    if (value.trim()) {
      onSend(value.trim());
      setValue('');
    }
  }, [value, onSend]);

  // 键盘事件
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
  const handleStateChange = useCallback((state: VoiceButtonState) => {
    // 可以在这里添加状态提示
  }, []);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t bg-card shrink-0 safe-area-pb">
      {/* 语音输入按钮 */}
      <VoiceInputButton
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
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={inputClassName}
        style={{
          flex: 1,
        }}
      />

      {/* 发送按钮 */}
      <Button
        onClick={handleSend}
        disabled={!value.trim()}
        size="icon"
        className="shrink-0"
      >
        <Send size={18} />
      </Button>
    </div>
  );
}
