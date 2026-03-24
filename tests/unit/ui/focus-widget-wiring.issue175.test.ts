import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new focus timer widget wiring issue-175（新专注计时组件接线）', () => {
  const chatPagePath = path.resolve('src/components/Chat/ChatPage.tsx');
  const source = readFileSync(chatPagePath, 'utf-8');

  it('adds showTimerWidget prop for new-mobile record tab reuse（为记录 Tab 复用增加 showTimerWidget 开关）', () => {
    expect(source).toContain('showTimerWidget?: boolean');
    expect(source).toContain('showTimerWidget = true');
  });

  it('uses FocusTimerWidget for new-mobile variant only when enabled（新移动端仅在开启时渲染新组件）', () => {
    expect(source).toContain("import { FocusTimerWidget");
    expect(source).toContain("variant === 'new-mobile' && showTimerWidget ? (");
    expect(source).toContain('<FocusTimerWidget ref={focusTimerWidgetRef} />');
  });

  it('keeps old TimeBlockWidget for default variant（默认端保留旧组件）', () => {
    expect(source).toContain('<TimeBlockWidget ref={timeBlockWidgetRef} variant="default" />');
  });
});
