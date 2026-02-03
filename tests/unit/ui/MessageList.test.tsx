import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageList } from '@/components/Chat/MessageList';
import '@testing-library/jest-dom';

// 辅助函数：创建测试消息
function createTestMessage(id: string, content: string, senderId: string, receiverId: string) {
  return {
    id,
    content,
    senderId,
    receiverId,
    timestamp: Date.now(),
  };
}

describe('MessageList', () => {
  const mockMessages = [
    createTestMessage('1', 'Hello', 'device-002', 'device-001'),
    createTestMessage('2', 'World', 'device-001', 'device-002'),
  ];
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should render messages in order', () => {
    render(<MessageList messages={mockMessages} currentDevice="device-001" />);
    
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
  });
  
  it('should distinguish sent vs received messages', () => {
    render(<MessageList messages={mockMessages} currentDevice="device-001" />);
    
    // 发送的消息在右边（自己发的），接收的在左边
    const messages = screen.getAllByTestId(/message-/);
    expect(messages[0]).toHaveClass('message-received');
    expect(messages[1]).toHaveClass('message-sent');
  });
  
  it('should load more on scroll to top', async () => {
    const loadMore = vi.fn();
    render(<MessageList 
      messages={mockMessages} 
      currentDevice="device-001"
      onLoadMore={loadMore}
    />);
    
    // 模拟滚动到顶部
    const container = screen.getByTestId('message-container');
    fireEvent.scroll(container, { target: { scrollTop: 0 } });
    
    await waitFor(() => {
      expect(loadMore).toHaveBeenCalled();
    });
  });
  
  it('should show loading indicator', () => {
    render(<MessageList 
      messages={mockMessages} 
      currentDevice="device-001"
      loading={true}
    />);
    
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });
});
