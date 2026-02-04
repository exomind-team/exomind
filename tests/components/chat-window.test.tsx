import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatWindow } from '../../src/components/Chat/ChatWindow';
import type { ChatMessage } from '../../lib/stores/chat-store';

const mockMessages: ChatMessage[] = [
  { id: '1', content: 'Hello', timestamp: Date.now() - 60000, sender: 'device-a', status: 'delivered' },
  { id: '2', content: 'Hi there!', timestamp: Date.now() - 30000, sender: 'device-b', status: 'delivered' },
];

describe('ChatWindow', () => {
  const onSend = vi.fn();

  beforeEach(() => {
    onSend.mockClear();
  });

  it('should display empty state when no device selected', () => {
    render(
      <ChatWindow
        messages={[]}
        selectedDevice={null}
        isConnected={false}
        isConnecting={false}
        onSend={onSend}
      />
    );

    expect(screen.getByText('选择一个设备开始对话')).toBeInTheDocument();
  });

  it('should display device info when device selected', () => {
    render(
      <ChatWindow
        messages={[]}
        selectedDevice={{ id: 'd1', name: 'Test Device', ip: '192.168.1.100', port: 8080, type: 'desktop' }}
        isConnected={false}
        isConnecting={true}
        onSend={onSend}
      />
    );

    expect(screen.getByText(/Test Device/)).toBeInTheDocument();
    expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    expect(screen.getByText('连接中...')).toBeInTheDocument();
  });

  it('should display messages', () => {
    render(
      <ChatWindow
        messages={mockMessages}
        selectedDevice={{ id: 'device-a', name: 'My Device', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={true}
        isConnecting={false}
        onSend={onSend}
      />
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('should show sent message on right side', () => {
    const { container } = render(
      <ChatWindow
        messages={mockMessages}
        selectedDevice={{ id: 'device-a', name: 'My Device', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={true}
        isConnecting={false}
        onSend={onSend}
      />
    );

    const sentMessage = container.querySelector('.message.sent');
    expect(sentMessage).toBeInTheDocument();
  });

  it('should show received message on left side', () => {
    const { container } = render(
      <ChatWindow
        messages={mockMessages}
        selectedDevice={{ id: 'device-a', name: 'My Device', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={true}
        isConnecting={false}
        onSend={onSend}
      />
    );

    const receivedMessage = container.querySelector('.message.received');
    expect(receivedMessage).toBeInTheDocument();
  });

  it('should call onSend when sending message', () => {
    render(
      <ChatWindow
        messages={[]}
        selectedDevice={{ id: 'd1', name: 'Test', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={true}
        isConnecting={false}
        onSend={onSend}
      />
    );

    const textarea = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(textarea, { target: { value: 'Test message' } });

    const sendBtn = screen.getByText('发送');
    fireEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledWith('Test message');
  });

  it('should clear input after sending', () => {
    render(
      <ChatWindow
        messages={[]}
        selectedDevice={{ id: 'd1', name: 'Test', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={true}
        isConnecting={false}
        onSend={onSend}
      />
    );

    const textarea = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    expect(textarea).toHaveValue('Test message');

    fireEvent.click(screen.getByText('发送'));
    expect(textarea).toHaveValue('');
  });

  it('should show connection status', () => {
    const { rerender } = render(
      <ChatWindow
        messages={[]}
        selectedDevice={{ id: 'd1', name: 'Test', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={false}
        isConnecting={true}
        onSend={onSend}
      />
    );

    expect(screen.getByText('连接中...')).toBeInTheDocument();

    rerender(
      <ChatWindow
        messages={[]}
        selectedDevice={{ id: 'd1', name: 'Test', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={true}
        isConnecting={false}
        onSend={onSend}
      />
    );

    expect(screen.getByText('已连接')).toBeInTheDocument();
  });

  it('should disable send button when disconnected', () => {
    render(
      <ChatWindow
        messages={[]}
        selectedDevice={{ id: 'd1', name: 'Test', ip: '192.168.1.1', port: 8080, type: 'desktop' }}
        isConnected={false}
        isConnecting={false}
        onSend={onSend}
      />
    );

    const sendBtn = screen.getByText('发送');
    expect(sendBtn).toBeDisabled();
  });
});
