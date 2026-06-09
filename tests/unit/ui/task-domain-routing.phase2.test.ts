import { describe, expect, it } from 'vitest';

import {
  buildTaskDetailSourceSearch,
  buildTaskDomainBackLink,
  getTaskDomainViewPath,
  resolveTaskDomainSourceConfig,
} from '@/ui/app/pages/task-domain-routing';

describe('task domain routing phase 2（任务域返回与导航契约）', () => {
  it('resolves task domain top-level paths（任务域顶层路径映射稳定）', () => {
    expect(getTaskDomainViewPath('list')).toBe('/tasks');
    expect(getTaskDomainViewPath('timeline')).toBe('/tasks/timeline');
    expect(getTaskDomainViewPath('dag')).toBe('/tasks/dag');
    expect(getTaskDomainViewPath('proposals')).toBe('/proposals');
  });

  it('maps task detail source search to stable route keys（详情页来源参数映射稳定）', () => {
    expect(buildTaskDetailSourceSearch('dag')).toEqual({ from: 'dag' });
    expect(buildTaskDetailSourceSearch('timeline')).toEqual({ from: 'timeline' });
  });

  it('builds a fallback back link to tasks main view（默认回到任务主入口）', () => {
    expect(buildTaskDomainBackLink(null, 'list')).toEqual({
      to: '/tasks',
      label: '← 返回任务',
      sourceLabel: '任务',
    });
  });

  it('maps dag and timeline sources to consistent back links（DAG 与时间线来源返回一致）', () => {
    expect(resolveTaskDomainSourceConfig('dag')).toEqual({ label: '依赖图', to: '/tasks/dag' });
    expect(resolveTaskDomainSourceConfig('timeline')).toEqual({ label: '时间线', to: '/tasks/timeline' });
    expect(buildTaskDomainBackLink('dag')).toEqual({
      to: '/tasks/dag',
      label: '← 返回依赖图',
      sourceLabel: '依赖图',
    });
    expect(buildTaskDomainBackLink('timeline')).toEqual({
      to: '/tasks/timeline',
      label: '← 返回时间线',
      sourceLabel: '时间线',
    });
  });
});
