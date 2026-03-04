import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('ChatPage m4（AI 反馈紫色气泡样式）', () => {
  it('renders agent_feedback bubble with violet token classes in new-mobile variant（new-mobile 紫色反馈）', () => {
    const source = readFileSync('src/components/Chat/ChatPage.tsx', 'utf-8');

    expect(source).toContain("const isAgentFeedback = event.tags.has('agent_feedback');");
    expect(source).toContain("data-testid={isAgentFeedback ? 'new-mobile-agent-feedback-bubble' : undefined}");
    expect(source).toContain(
      "'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950/35 dark:text-violet-100'",
    );
  });
});

