import { useState, KeyboardEvent } from 'react';

interface MessageInputProps {
  onSend: (content: string) => void;
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      onSend(value.trim());
      setValue('');
    }
  };

  return (
    <div className="flex p-4 border-t border-border-card bg-background">
      <input
        type="text"
        placeholder="输入消息..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 px-4 py-3 rounded-[20px] border border-border-card bg-card text-primary text-sm outline-none"
      />
    </div>
  );
}
