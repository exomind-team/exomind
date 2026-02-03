import React from 'react';
import { Device } from './DevicePanel';

export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'other';
  timestamp: number;
}

export interface ChatWindowProps {
  messages: Message[];
  devices: Device[];
  currentDevice: string;
  connectionStatus: 'connected' | 'connecting' | 'offline' | 'error';
  onSend: (content: string) => void;
}

export function ChatWindow({ 
  messages, 
  devices, 
  currentDevice,
  connectionStatus,
  onSend 
}: ChatWindowProps): React.ReactElement {
  const [inputValue, setInputValue] = React.useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const handleSend = () => {
    if (inputValue.trim()) {
      onSend(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中...';
      case 'offline': return '离线模式';
      case 'error': return '连接错误';
      default: return '';
    }
  };

  return (
    <div className='chat-window'>
      <div className='chat-header'>
        <span className={'connection-status ' + connectionStatus}>
          {getConnectionStatusText()}
        </span>
      </div>

      <div className='chat-content'>
        <div className='message-list' data-testid='message-list'>
          {messages.map(msg => (
            <div 
              key={msg.id}
              className={'message ' + msg.sender}
            >
              <div className='message-content'>{msg.content}</div>
              <div className='message-time'>
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className='message-input-wrapper' data-testid='message-input'>
          <textarea
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder='输入消息...'
            rows={1}
          />
          <button onClick={handleSend} disabled={connectionStatus === 'offline'}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatWindow;
