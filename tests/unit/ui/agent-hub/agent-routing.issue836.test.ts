import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('issue-836 PTY fullscreen route wiring（PTY 全屏路由接线）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('mounts the standalone PTY route（挂载独立 PTY 页面路由）', () => {
    expect(source).toContain("path: '/agents/pty/$ptyId'");
    expect(source).toContain('<PtyTerminalPage ptyId={ptyId} />');
  });

  it('treats PTY pages as mobile fullscreen routes（移动端应把 PTY 页面视为全屏面）', () => {
    expect(source).toContain("pathname.startsWith('/agents/pty/')");
  });
});
