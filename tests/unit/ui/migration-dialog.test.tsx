import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MigrationDialog } from '@/ui/components/MigrationDialog';
import type { LegacyDataSummary } from '@/lib/migration/legacy-migration-detector';
import type { MigrationProgress } from '@/lib/migration/legacy-migration-executor';

function makeSummary(overrides: Partial<LegacyDataSummary> = {}): LegacyDataSummary {
  return {
    eventlogCount: 5,
    taskCount: 3,
    timeblockCount: 2,
    hasActiveBlock: false,
    hasAnyData: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('MigrationDialog（旧数据迁移弹窗）', () => {
  it('renders data summary correctly when open（打开时正确渲染数据摘要）', () => {
    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText('检测到旧版数据')).toBeInTheDocument();
    // Each list item spans multiple DOM elements (count is in a nested <span>).
    // Use getByText with an exact=false option, which matches nodes whose full
    // text content contains the substring.
    expect(screen.getByText(/事件日志/, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/任务/, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/时间块/, { exact: false })).toBeInTheDocument();
    // Counts appear in <span> elements
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls onMigrate when migrate button clicked（点击立即迁移时调用 onMigrate）', () => {
    const onMigrate = vi.fn();
    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={onMigrate}
        onSkip={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '立即迁移' }));
    expect(onMigrate).toHaveBeenCalledTimes(1);
  });

  it('calls onSkip when skip button clicked（点击暂不迁移时调用 onSkip）', () => {
    const onSkip = vi.fn();
    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={onSkip}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '暂不迁移' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('shows progress during migration（迁移中显示进度信息）', () => {
    const progress: MigrationProgress = {
      domain: 'eventlog',
      step: 1,
      totalSteps: 3,
      label: '迁移事件日志',
    };

    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
        migrating
        progress={progress}
      />,
    );

    // Multiple elements can match /正在迁移/ (visible <p> + hidden sr-only title)
    expect(screen.getAllByText(/正在迁移/).length).toBeGreaterThan(0);
    // The progress label and step info are rendered inside a single <span>;
    // use getAllByText with a regex so the full text content of the <span> matches.
    expect(screen.getAllByText(/迁移事件日志/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1.*3/).length).toBeGreaterThan(0);
  });

  it('hides skip and migrate buttons during migration（迁移中隐藏跳过和迁移按钮）', () => {
    const progress: MigrationProgress = {
      domain: 'task',
      step: 2,
      totalSteps: 3,
      label: '迁移任务',
    };

    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
        migrating
        progress={progress}
      />,
    );

    expect(screen.queryByRole('button', { name: '立即迁移' })).toBeNull();
    expect(screen.queryByRole('button', { name: '暂不迁移' })).toBeNull();
  });

  it('does not render content when open is false（关闭时不渲染内容）', () => {
    render(
      <MigrationDialog
        open={false}
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.queryByText('检测到旧版数据')).toBeNull();
    expect(screen.queryByRole('button', { name: '立即迁移' })).toBeNull();
  });

  it('shows error state with fallback button（错误状态显示错误信息和后备按钮）', () => {
    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
        error="RT connection refused"
      />,
    );

    expect(screen.getByText('迁移失败')).toBeInTheDocument();
    expect(screen.getByText(/RT connection refused/)).toBeInTheDocument();
    expect(screen.getByText('RT connection refused').tagName).toBe('PRE');
    expect(screen.getByRole('button', { name: '继续使用旧版存储' })).toBeInTheDocument();
  });

  it('calls onSkip when fallback button clicked in error state（错误状态点击后备按钮时调用 onSkip）', () => {
    const onSkip = vi.fn();
    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={onSkip}
        error="something went wrong"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '继续使用旧版存储' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('allows dismissing error state with Escape（错误态允许按 Esc 退出）', () => {
    const onErrorDismiss = vi.fn();
    render(
      <MigrationDialog
        open
        summary={makeSummary()}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
        onErrorDismiss={onErrorDismiss}
        error={'x'.repeat(600)}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onErrorDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows hasActiveBlock annotation in timeblock line（有活跃时间块时显示注记）', () => {
    render(
      <MigrationDialog
        open
        summary={makeSummary({ timeblockCount: 1, hasActiveBlock: true })}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText(/含进行中/)).toBeInTheDocument();
  });

  it('hides zero-count rows from summary（计数为零的数据行不显示）', () => {
    render(
      <MigrationDialog
        open
        summary={makeSummary({ taskCount: 0 })}
        onMigrate={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.queryByText(/任务/)).toBeNull();
  });
});
