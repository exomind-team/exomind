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
    <div style={{
      display: 'flex',
      padding: '16px',
      borderTop: '1px solid hsl(var(--border-card, 0 0% 15%))',
      backgroundColor: 'hsl(var(--background, 0 0% 4%))',
    }}>
      <input
        type="text"
        placeholder="输入消息..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          flex: 1,
          padding: '12px 16px',
          borderRadius: '20px',
          border: '1px solid hsl(var(--border-card, 0 0% 15%))',
          outline: 'none',
          fontSize: '14px',
          backgroundColor: 'hsl(var(--bg-card, 0 0% 10%))',
          color: 'hsl(var(--text-primary, 0 0% 100%))',
        }}
      />
    </div>
  );
}
