import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('issue-213 task routing wiring（任务路由接线）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('adds tasks entry to bottom nav（底部导航新增任务入口）', () => {
    expect(source).toContain("title: '任务'");
    expect(source).toContain('SquareCheckBig');
  });

  it('defines /tasks route（定义任务列表路由）', () => {
    expect(source).toContain("path: '/tasks'");
  });

  it('defines /tasks/:id style detail route（定义任务详情路由）', () => {
    expect(source).toContain("path: '/tasks/$taskId'");
  });
});

