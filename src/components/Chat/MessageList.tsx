import { useRef } from 'react';
import { escapeHtml } from '../../lib/utils/html-sanitize';

export interface Message {
  id: string;
  content: string;
  senderId: string;
  receiverId: string;
  timestamp: number;
}

interface MessageListProps {
  messages: Message[];
  currentDevice: string;
  loading?: boolean;
  onLoadMore?: () => void;
}

export function MessageList({ 
  messages, 
  currentDevice, 
  loading = false,
  onLoadMore 
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (containerRef.current && onLoadMore) {
      const { scrollTop } = containerRef.current;
      if (scrollTop === 0) {
        onLoadMore();
      }
    }
  };

  return (
    <div 
      ref={containerRef}
      data-testid="message-container"
      onScroll={handleScroll}
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: '16px',
      }}
    >
      {loading && <div data-testid="loading">加载中...</div>}
      
      {messages.map((message) => {
        const isSent = message.senderId === currentDevice;
        return (
          <div
            key={message.id}
            data-testid={`message-${message.id}`}
            className={isSent ? 'message-sent' : 'message-received'}
            style={{
              maxWidth: '70%',
              margin: '8px 0',
              marginLeft: isSent ? 'auto' : '8px',
              padding: '12px 16px',
              borderRadius: isSent ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              backgroundColor: isSent ? '#007aff' : '#e5e5ea',
              color: isSent ? '#fff' : '#000',
            }}
          >
            <div
              data-testid={`message-content-${message.id}`}
              className="break-words"
              dangerouslySetInnerHTML={{ __html: escapeHtml(message.content) }}
            />
          </div>
        );
      })}
    </div>
  );
}
