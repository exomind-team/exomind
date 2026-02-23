import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('issue-204 agent routing wiring（Agent 路由接线）', () => {
  const sourcePath = path.resolve('src/routes-new.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('keeps /agents main route（保留主入口）', () => {
    expect(source).toContain("path: '/agents'");
  });

  it('adds agent detail route（新增 Agent 详情路由）', () => {
    expect(source).toContain("path: '/agents/agent/$agentId'");
  });

  it('adds actor detail route（新增 Actor 详情路由）', () => {
    expect(source).toContain("path: '/agents/actor/$actorId'");
  });

  it('adds chat and market routes（新增对话与市场路由）', () => {
    expect(source).toContain("path: '/agents/chat/$agentId'");
    expect(source).toContain("path: '/agents/market'");
  });
});

