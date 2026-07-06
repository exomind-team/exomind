import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntentProgramsPage } from '@/ui/app/pages/IntentProgramsPage';
import { createSeedIntentPrograms } from '@/lib/services/intent-program.service';

const programs = createSeedIntentPrograms('2026-07-07T08:00:00.000Z');
const listProgramsMock = vi.fn();
const runProgramMock = vi.fn();
const acceptRunMock = vi.fn();
const overrideRunMock = vi.fn();
const recertifyProgramMock = vi.fn();
const pauseProgramMock = vi.fn();
const retireProgramMock = vi.fn();
const calculateMetricsMock = vi.fn();
const listSovereigntyEventsMock = vi.fn();

vi.mock('@/lib/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services')>();
  return {
    ...actual,
    getIntentProgramService: () => ({
      listPrograms: listProgramsMock,
      runProgram: runProgramMock,
      acceptRun: acceptRunMock,
      overrideRun: overrideRunMock,
      recertifyProgram: recertifyProgramMock,
      pauseProgram: pauseProgramMock,
      retireProgram: retireProgramMock,
      calculateMetrics: calculateMetricsMock,
      listSovereigntyEvents: listSovereigntyEventsMock,
    }),
  };
});

describe('IntentProgramsPage（意图程序页）', () => {
  beforeEach(() => {
    listProgramsMock.mockReset();
    runProgramMock.mockReset();
    acceptRunMock.mockReset();
    overrideRunMock.mockReset();
    recertifyProgramMock.mockReset();
    pauseProgramMock.mockReset();
    retireProgramMock.mockReset();
    calculateMetricsMock.mockReset();
    listSovereigntyEventsMock.mockReset();

    listProgramsMock.mockResolvedValue(structuredClone(programs));
    calculateMetricsMock.mockReturnValue({
      total: 5,
      delegated: 3,
      awaitingHumanReview: 1,
      needsReauthoring: 1,
      averageSovereigntyScore: 92,
    });
    listSovereigntyEventsMock.mockResolvedValue([
      {
        id: 'event-override',
        timestamp: Date.parse('2026-07-07T09:00:00.000Z'),
        content: '人工覆写意图程序：Agent 代码修改验收闸门',
        tags: ['intent_program', 'intent_override'],
      },
      {
        id: 'event-run',
        timestamp: Date.parse('2026-07-07T08:00:00.000Z'),
        content: '试运行意图程序：技术调研整理为 Markdown',
        tags: ['intent_program', 'intent_run'],
      },
    ]);
    runProgramMock.mockResolvedValue({
      program: {
        ...programs[0],
        state: 'awaiting_review',
        runs: [
          {
            id: 'run-1',
            programId: 'research-to-note',
            startedAt: '2026-07-07T08:00:00.000Z',
            state: 'awaiting_review',
            inputSnapshot: '网页链接',
            executorSnapshot: ['Codex'],
            machineOutput: '候选调研笔记等待人核验收',
            verificationSnapshot: 'claim/method/source/verdict/confidence',
          },
        ],
      },
      record: {
        id: 'run-1',
        programId: 'research-to-note',
        startedAt: '2026-07-07T08:00:00.000Z',
        state: 'awaiting_review',
        inputSnapshot: '网页链接',
        executorSnapshot: ['Codex'],
        machineOutput: '候选调研笔记等待人核验收',
        verificationSnapshot: 'claim/method/source/verdict/confidence',
      },
    });
    overrideRunMock.mockResolvedValue({
      ...programs[0],
      state: 'overridden',
      runs: [
        {
          id: 'run-1',
          programId: 'research-to-note',
          startedAt: '2026-07-07T08:00:00.000Z',
          state: 'overridden',
          inputSnapshot: '网页链接',
          executorSnapshot: ['Codex'],
          machineOutput: '候选调研笔记等待人核验收',
          humanOutput: '先补红灯测试',
          decisionNote: '先补红灯测试',
          verificationSnapshot: 'claim/method/source/verdict/confidence',
        },
      ],
    });
    acceptRunMock.mockResolvedValue({
      ...programs[2],
      state: 'accepted',
      runs: [],
    });
    recertifyProgramMock.mockResolvedValue({
      ...programs[0],
      state: 'needs_reauthoring',
      recertification: {
        ...programs[0].recertification,
        lastVerdict: 'fail',
        lastNote: '解释不清来源要求',
      },
    });
    pauseProgramMock.mockResolvedValue({
      ...programs[0],
      state: 'paused',
    });
    retireProgramMock.mockResolvedValue({
      ...programs[0],
      state: 'retired',
    });
  });

  it('renders Intent Deck as a runtime, not theory copy（展示意图程序运行时而非理论展板）', async () => {
    render(<IntentProgramsPage />);

    expect(await screen.findByRole('heading', { name: '意图程序' })).toBeInTheDocument();
    expect(screen.getByText('Intent Deck')).toBeInTheDocument();
    expect(screen.getByText('人核待验收')).toBeInTheDocument();
    expect(screen.getByText('待重新著作')).toBeInTheDocument();
    expect(screen.getByTestId('intent-program-card-code-review-gate')).toBeInTheDocument();
    expect(screen.getByText('EventLog 对账')).toBeInTheDocument();
    expect(screen.getByText('人工覆写意图程序：Agent 代码修改验收闸门')).toBeInTheDocument();
    expect(screen.getAllByText('claim/method/source/verdict').length).toBeGreaterThan(0);
    expect(screen.getAllByText('EventLog canonical').length).toBeGreaterThan(0);
  });

  it('runs a program into human gate and records override（运行后进入人核闸门并可覆写）', async () => {
    render(<IntentProgramsPage />);

    await screen.findByTestId('intent-program-card-research-to-note');
    fireEvent.click(screen.getByRole('button', { name: '试运行 技术调研整理为 Markdown' }));

    await waitFor(() => {
      expect(runProgramMock).toHaveBeenCalledWith('research-to-note');
      expect(screen.getByText('候选调研笔记等待人核验收')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '覆写执行记录 run-1' }));

    await waitFor(() => {
      expect(overrideRunMock).toHaveBeenCalledWith('research-to-note', 'run-1', expect.stringContaining('人核'));
      expect(screen.getByText('overridden')).toBeInTheDocument();
    });
  });

  it('shows recertification failure as loss of run authority（再认证失败会显示运行权丧失）', async () => {
    render(<IntentProgramsPage />);

    await screen.findByTestId('intent-program-card-research-to-note');
    fireEvent.click(screen.getByRole('button', { name: '再认证失败 技术调研整理为 Markdown' }));

    await waitFor(() => {
      expect(recertifyProgramMock).toHaveBeenCalledWith('research-to-note', {
        verdict: 'fail',
        note: '我现在解释不清这张卡的来源策略与验收标准。',
      });
      expect(screen.getAllByText('needs_reauthoring').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('运行权已阻断').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('lets human pass or partially pass recertification（人可以通过或部分通过再认证）', async () => {
    render(<IntentProgramsPage />);

    await screen.findByTestId('intent-program-card-research-to-note');
    recertifyProgramMock.mockResolvedValueOnce({
      ...programs[0],
      state: 'delegated',
      recertification: {
        ...programs[0].recertification,
        lastVerdict: 'pass',
        lastNote: '仍能解释。',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '再认证通过 技术调研整理为 Markdown' }));

    await waitFor(() => {
      expect(recertifyProgramMock).toHaveBeenCalledWith('research-to-note', {
        verdict: 'pass',
        note: '我仍能解释这张卡的来源策略、验收标准与撤回边界。',
      });
    });

    recertifyProgramMock.mockResolvedValueOnce({
      ...programs[3],
      state: 'paused',
      recertification: {
        ...programs[3].recertification,
        lastVerdict: 'partial',
        lastNote: '部分掌控。',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '再认证部分通过 碎片想法整理为文章提纲' }));

    await waitFor(() => {
      expect(recertifyProgramMock).toHaveBeenLastCalledWith('idea-to-outline', {
        verdict: 'partial',
        note: '我只能解释部分边界，先降级暂停，补完著作再委托。',
      });
      expect(screen.getByText('paused')).toBeInTheDocument();
    });
  });

  it('lets human pause a delegated program（人可以暂停委托）', async () => {
    render(<IntentProgramsPage />);

    await screen.findByTestId('intent-program-card-research-to-note');
    fireEvent.click(screen.getByRole('button', { name: '暂停 技术调研整理为 Markdown' }));

    await waitFor(() => {
      expect(pauseProgramMock).toHaveBeenCalledWith('research-to-note', expect.stringContaining('人核'));
      expect(screen.getByText('paused')).toBeInTheDocument();
    });
  });

  it('lets human retire a program（人可以退役委托）', async () => {
    render(<IntentProgramsPage />);

    await screen.findByTestId('intent-program-card-research-to-note');
    fireEvent.click(screen.getByRole('button', { name: '退役 技术调研整理为 Markdown' }));

    await waitFor(() => {
      expect(retireProgramMock).toHaveBeenCalledWith('research-to-note', expect.stringContaining('人核'));
      expect(screen.getByText('retired')).toBeInTheDocument();
    });
  });
});
