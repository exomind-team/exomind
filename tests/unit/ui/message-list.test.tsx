import { render, screen } from '@testing-library/react';
import { MessageList } from '@/components/Chat/MessageList';

// MessageList XSS 测试需要 DOM 环境
const isDomAvailable = typeof document !== 'undefined';

(isDomAvailable ? describe : describe.skip)('MessageList XSS Protection', () => {
  it('should escape script tags in message content', () => {
    const maliciousMessage = {
      id: 'msg-1',
      content: '<script>alert("xss")</script>',
      senderId: 'device-1',
      receiverId: 'device-2',
      timestamp: Date.now(),
    };

    render(
      <MessageList
        messages={[maliciousMessage]}
        currentDevice="device-2"
      />
    );
    const contentElement = screen.getByTestId('message-content-msg-1');

    // Script tags should be escaped
    expect(contentElement.innerHTML).toContain('&lt;script&gt;');
  });

  it('should escape img tags with event handlers', () => {
    const htmlMessage = {
      id: 'msg-2',
      content: '<img src=x onerror=alert(1)>',
      senderId: 'device-1',
      receiverId: 'device-2',
      timestamp: Date.now(),
    };

    render(
      <MessageList
        messages={[htmlMessage]}
        currentDevice="device-2"
      />
    );
    const contentElement = screen.getByTestId('message-content-msg-2');

    // Should escape the img tag
    expect(contentElement.innerHTML).toContain('&lt;img');
  });

  it('should escape angle brackets', () => {
    const specialCharMessage = {
      id: 'msg-3',
      content: 'Test <>&"\' characters',
      senderId: 'device-1',
      receiverId: 'device-2',
      timestamp: Date.now(),
    };

    render(
      <MessageList
        messages={[specialCharMessage]}
        currentDevice="device-2"
      />
    );
    const contentElement = screen.getByTestId('message-content-msg-3');

    // Should contain escaped angle brackets
    expect(contentElement.innerHTML).toContain('&lt;');
    expect(contentElement.innerHTML).toContain('&gt;');
  });

  it('should preserve normal text content', () => {
    const normalMessage = {
      id: 'msg-4',
      content: 'Hello, this is a normal message!',
      senderId: 'device-1',
      receiverId: 'device-2',
      timestamp: Date.now(),
    };

    render(
      <MessageList
        messages={[normalMessage]}
        currentDevice="device-2"
      />
    );
    const contentElement = screen.getByTestId('message-content-msg-4');

    // Normal text should be visible
    expect(contentElement.textContent).toContain('Hello');
  });

  it('should handle message with only numbers and symbols', () => {
    const symbolMessage = {
      id: 'msg-5',
      content: '12345 @#$%^&*()',
      senderId: 'device-1',
      receiverId: 'device-2',
      timestamp: Date.now(),
    };

    render(
      <MessageList
        messages={[symbolMessage]}
        currentDevice="device-2"
      />
    );
    const contentElement = screen.getByTestId('message-content-msg-5');

    expect(contentElement.textContent).toContain('12345');
  });
});
