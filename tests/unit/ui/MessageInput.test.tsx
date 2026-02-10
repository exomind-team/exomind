import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from '@/components/Chat/MessageInput';
import '@testing-library/jest-dom';

// MessageInput 测试需要 DOM 环境
const isDomAvailable = typeof document !== 'undefined';

(isDomAvailable ? describe : describe.skip)('MessageInput', () => {
  it('should update input value', () => {
    render(<MessageInput onSend={vi.fn()} />);
    
    const input = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(input, { target: { value: 'Hello' } });
    
    expect(input.value).toBe('Hello');
  });
  
  it('should call onSend on Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);
    
    const input = screen.getByPlaceholderText('输入消息...');
    // 先输入内容
    fireEvent.change(input, { target: { value: 'Hello' } });
    // 再按 Enter
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    
    expect(onSend).toHaveBeenCalledWith('Hello');
  });
  
  it('should clear input after send', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);
    
    const input = screen.getByPlaceholderText('输入消息...');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    
    expect(input.value).toBe('');
  });
});
