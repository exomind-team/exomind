import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrestartTaskSelectionList } from '@/ui/app/components/prestart-task-selection';

describe('PrestartTaskSelectionList shared select overflow（预选任务溢出下拉走共享 Select）', () => {
  it('uses the shared select trigger and toggles overflow tasks（使用共享下拉并支持选择溢出任务）', async () => {
    const user = userEvent.setup();
    const onSelectedTaskIdsChange = vi.fn();

    render(
      <PrestartTaskSelectionList
        tasks={[
          {
            id: 'task-1',
            title: '任务一',
            status: 'pending',
            priority: 'medium',
            dependsOn: [],
            tags: [],
            estimatedMinutes: 25,
            timeBlockIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'task-2',
            title: '任务二',
            status: 'in_progress',
            priority: 'high',
            dependsOn: [],
            tags: [],
            estimatedMinutes: 45,
            timeBlockIds: [],
            createdAt: 2,
            updatedAt: 2,
          },
        ]}
        selectedTaskIds={[]}
        onSelectedTaskIdsChange={onSelectedTaskIdsChange}
        listTestId="prestart-task-list"
        itemTestIdPrefix="prestart-task-"
        emptyLabel="没有候选任务"
        maxVisibleTasks={1}
        overflowSelectLabel="更多任务"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: '更多任务' });
    expect(trigger.tagName).not.toBe('SELECT');

    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: '[已选] 任务二 · 已选' }).catch(async () => {
      return screen.findByRole('option', { name: '任务二 · 进行中' });
    }));

    expect(onSelectedTaskIdsChange).toHaveBeenCalledWith(['task-2']);
  });
});
