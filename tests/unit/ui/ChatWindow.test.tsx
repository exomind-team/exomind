import { describe, it, expect, beforeAll } from 'vitest';

let ChatWindow;
let ChatWindowModule;

async function loadDeps() {
  ChatWindowModule = await import('../../../src/components/Chat/ChatWindow');
  ChatWindow = ChatWindowModule.default || ChatWindowModule.ChatWindow;
}

describe('ChatWindow', () => {
  beforeAll(async () => {
    await loadDeps();
  });

  it('should export ChatWindow as default function', () => {
    expect(ChatWindow).toBeDefined();
    expect(typeof ChatWindow).toBe('function');
  });
  
  it('should export default from module', () => {
    expect(ChatWindowModule.default).toBeDefined();
  });
});
