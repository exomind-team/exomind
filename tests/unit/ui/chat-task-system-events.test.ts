import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ChatPage task system events', () => {
  it('treats task lifecycle events as system messages instead of user bubbles（task_* 按系统事件渲染）', () => {
    const source = readFileSync('src/components/Chat/ChatPage.tsx', 'utf-8');

    expect(source).toContain("const TASK_SYSTEM_EVENT_TAGS = [");
    expect(source).toContain("'task_created'");
    expect(source).toContain("'task_started'");
    expect(source).toContain("'task_resumed'");
    expect(source).toContain("'task_suspended'");
    expect(source).toContain("'task_completed'");
    expect(source).toContain("'task_cancelled'");
    expect(source).toContain("'task_transition'");
    expect(source).toContain("'task_linked'");
    expect(source).toContain("'task_unlinked'");
    expect(source).toContain("event.tags.has('agent_feedback') ? 'AI 助理' : '系统'");
  });

  it('separates task lifecycle events from task relation events in icon/color mapping（#726）', () => {
    const source = readFileSync('src/components/Chat/ChatPage.tsx', 'utf-8');

    expect(source).toContain('const TASK_LIFECYCLE_EVENT_TAGS = [');
    expect(source).toContain("'task_transition'");
    expect(source).toContain('const TASK_RELATION_EVENT_TAGS = [');
    expect(source).toContain("'task_linked'");
    expect(source).toContain("'task_unlinked'");
    expect(source).toContain('Link2');
    expect(source).toContain('ListTodo');
  });
});
