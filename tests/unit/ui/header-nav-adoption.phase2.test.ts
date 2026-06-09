import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

describe('header nav adoption phase 2（头部导航共享层接入）', () => {
  it('moves NowPage, TaskDomainTabs, and AgentsPage onto the shared header nav recipe（当下页、任务域、网络页接入共享头部导航 recipe）', () => {
    const nowSource = readSource('src/ui/app/pages/NowPage.tsx');
    const taskDomainSource = readSource('src/ui/app/components/TaskDomainTabs.tsx');
    const agentsSource = readSource('src/ui/app/pages/AgentsPage.tsx');

    expect(nowSource).toContain('PageHeaderNav');
    expect(taskDomainSource).toContain('PageHeaderNav');
    expect(agentsSource).toContain('PageHeaderNav');
  });
});
