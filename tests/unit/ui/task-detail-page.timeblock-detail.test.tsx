import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskDetailPage } from "@/ui/app/pages/TaskDetailPage";
import type { EventLogListOptions } from "@/lib/environment/interfaces/eventlog.port";
import type { TaskNode } from "@/lib/types/task";
import type { ActiveBlockData, TimeBlock } from "@/lib/types/event";

const navigateMock = vi.fn();
const scrollIntoViewMock = vi.fn();

const getTaskMock = vi.fn<(id: string) => Promise<TaskNode | null>>();
const listTasksMock =
  vi.fn<(includeCancelled?: boolean) => Promise<TaskNode[]>>();
const updateTaskMock =
  vi.fn<(id: string, input: Partial<TaskNode>) => Promise<TaskNode | null>>();
const addDependencyMock =
  vi.fn<
    (
      taskId: string,
      depTaskId: string,
      type: "soft" | "hard",
    ) => Promise<TaskNode | null>
  >();
const removeDependencyMock =
  vi.fn<(taskId: string, depTaskId: string) => Promise<TaskNode | null>>();
const getAvailableTransitionsMock =
  vi.fn<(id: string) => Promise<Array<TaskNode["status"]>>>();
const getChildTasksMock = vi.fn<(parentId: string) => Promise<TaskNode[]>>();
const checkDependenciesMetMock =
  vi.fn<
    (
      taskId: string,
    ) => Promise<{
      met: boolean;
      blocking: Array<{
        taskId: string;
        type: "soft" | "hard";
        status: TaskNode["status"];
      }>;
    }>
  >();
const onTaskChangeMock = vi.fn(() => () => {});

const loadTimeBlocksMock = vi.fn<() => Promise<TimeBlock[]>>();
const loadActiveBlockMock = vi.fn<() => Promise<ActiveBlockData | null>>();
const onBlockChangeMock = vi.fn(() => () => {});
const pauseBlockMock = vi.fn<() => Promise<void>>();

const calculateSpentMinutesMock = vi.fn<(taskId: string) => Promise<number>>();
const startBlockForTaskMock = vi.fn();
const addTaskToBlockMock = vi.fn();

const loadEventsMock =
  vi.fn<
    (
      options?: EventLogListOptions,
    ) => Promise<
      Array<{
        id: string;
        content: string;
        timestamp: number;
        tags: Set<string>;
      }>
    >
  >();
let currentTaskId = "task-1";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  useParams: () => ({ taskId: currentTaskId }),
  useNavigate: () => navigateMock,
  useLocation: () => ({
    pathname: window.location.pathname,
    searchStr: window.location.search,
  }),
}));

vi.mock("@/lib/services", () => ({
  getTaskService: () => ({
    getTask: getTaskMock,
    listTasks: listTasksMock,
    addDependency: addDependencyMock,
    removeDependency: removeDependencyMock,
    getAvailableTransitions: getAvailableTransitionsMock,
    getChildTasks: getChildTasksMock,
    checkDependenciesMet: checkDependenciesMetMock,
    onTaskChange: onTaskChangeMock,
    transitionTask: vi.fn(),
    updateTask: updateTaskMock,
    cancelTask: vi.fn(),
  }),
  getTimeBlockService: () => ({
    loadTimeBlocks: loadTimeBlocksMock,
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
    pauseBlock: pauseBlockMock,
  }),
  getEventLogService: () => ({
    loadEvents: loadEventsMock,
  }),
  getTaskTimerService: () => ({
    calculateSpentMinutes: calculateSpentMinutesMock,
    startBlockForTask: startBlockForTaskMock,
    addTaskToBlock: addTaskToBlockMock,
  }),
}));

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "task-1",
    title: "深度工作：EventLog 模块实现",
    description: "实现任务详情页首版",
    status: "completed",
    priority: "high",
    dependsOn: [],
    tags: ["frontend"],
    estimatedMinutes: 120,
    timeBlockIds: ["block-1"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const start = new Date("2026-03-06T09:00:00+08:00").getTime();
  const end = new Date("2026-03-06T10:30:00+08:00").getTime();
  return {
    id: "block-1",
    startId: "block-1",
    endId: "block-1-end",
    name: "深度工作：EventLog 模块实现",
    note: "中途依赖冲突，修复后恢复推进",
    tags: new Set(["block_feedback"]),
    startTime: start,
    endTime: end,
    ...overrides,
  };
}

describe("TaskDetailPage timeblock detail layout（任务详情布局）", () => {
  beforeEach(() => {
    currentTaskId = "task-1";
    window.history.replaceState({}, "", "/tasks/task-1");
    window.localStorage.clear();
    navigateMock.mockReset();
    scrollIntoViewMock.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    startBlockForTaskMock.mockReset();
    startBlockForTaskMock.mockResolvedValue(null);
    addTaskToBlockMock.mockReset();
    addTaskToBlockMock.mockResolvedValue(undefined);
    pauseBlockMock.mockReset();
    pauseBlockMock.mockResolvedValue(undefined);
    updateTaskMock.mockReset();
    updateTaskMock.mockImplementation(async (id, input) =>
      makeTask({
        id,
        ...input,
        updatedAt: Date.now(),
      }),
    );
    getTaskMock.mockImplementation(async (id: string) => {
      if (id === "task-2") {
        return makeTask({
          id: "task-2",
          title: "切换后的任务 B",
          estimatedMinutes: 30,
          status: "pending",
          createdAt: 30,
          updatedAt: 30,
        });
      }

      return makeTask({ status: "in_progress", createdAt: 20, updatedAt: 20 });
    });
    listTasksMock.mockResolvedValue([
      makeTask({
        id: "task-root",
        title: "优先收口 DAG 根节点",
        status: "pending",
        createdAt: 10,
        updatedAt: 10,
      }),
      makeTask({
        id: "task-1",
        title: "深度工作：EventLog 模块实现",
        status: "in_progress",
        createdAt: 20,
        updatedAt: 20,
      }),
      makeTask({
        id: "task-2",
        title: "切换后的任务 B",
        estimatedMinutes: 30,
        status: "pending",
        createdAt: 30,
        updatedAt: 30,
      }),
    ]);
    addDependencyMock.mockResolvedValue(makeTask());
    removeDependencyMock.mockResolvedValue(makeTask());
    getAvailableTransitionsMock.mockResolvedValue(["in_progress"]);
    getChildTasksMock.mockResolvedValue([]);
    checkDependenciesMetMock.mockResolvedValue({ met: true, blocking: [] });
    loadTimeBlocksMock.mockResolvedValue([makeBlock()]);
    loadActiveBlockMock.mockResolvedValue(null);
    calculateSpentMinutesMock.mockResolvedValue(90);
    loadEventsMock.mockResolvedValue([
      {
        id: "event-1",
        timestamp: new Date("2026-03-06T10:31:00+08:00").getTime(),
        content:
          "## AI 反馈：深度工作：EventLog 模块实现\n\n**做得好的** 主流程完成清晰\n\n**卡住的地方** 依赖冲突\n\n**建议** 拆分组件并补测试",
        tags: new Set(["agent_feedback"]),
      },
    ]);
  });

  it("renders mobile detail sections and legacy timer testids（移动端详情结构与兼容 testid）", async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledWith("task-1");
    });

    expect(
      (await screen.findAllByText("深度工作：EventLog 模块实现")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("概览")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "信息面板" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "计时控制" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "可执行任务" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "事件时间线" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "依赖关系" })).toBeInTheDocument();
    expect(screen.getAllByText("AI 总结").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "计划 vs 实际" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-timer-card")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-countup")).toBeInTheDocument();
    expect(screen.getByTestId("task-mode-countdown")).toBeInTheDocument();
    expect(screen.getByTestId("task-pause-button")).toBeInTheDocument();
  });

  it("loads eventlog within the linked block time range instead of a full snapshot（按关联时间块范围读取事件）", async () => {
    mockMatchMedia(false);
    const block = makeBlock();

    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(loadEventsMock).toHaveBeenCalledWith({
      sinceTimestamp: block.startTime,
      untilTimestamp: block.endTime,
    });
  });

  it("skips eventlog loading when the task has no related timeblocks（无关联时间块时不读事件日志）", async () => {
    mockMatchMedia(false);
    getTaskMock.mockResolvedValueOnce(
      makeTask({
        id: "task-1",
        status: "pending",
        timeBlockIds: [],
      }),
    );
    loadTimeBlocksMock.mockResolvedValueOnce([]);
    loadEventsMock.mockReset();
    loadEventsMock.mockResolvedValue([]);

    render(<TaskDetailPage />);

    await screen.findByText("暂无关联时间块，开始计时后会自动出现。");

    expect(loadEventsMock).not.toHaveBeenCalled();
  });

  it("orders portrait cards with info and timer before linked content（竖屏卡片顺序正确）", async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    const infoTitle = screen.getByRole("heading", { name: "信息面板" });
    const timerTitle = screen.getByRole("heading", { name: "计时控制" });
    const rootGuidance = screen.getByTestId("task-current-root-card");
    const linkedTitle = screen.getByRole("heading", { name: "关联时间块" });
    const timelineTitle = screen.getByRole("heading", { name: "事件时间线" });
    const aiSummaryTitle = screen.getByRole("heading", { name: "AI 总结" });
    const actionsTitle = screen.getByRole("heading", { name: "其他操作" });

    expect(
      infoTitle.compareDocumentPosition(timerTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      timerTitle.compareDocumentPosition(rootGuidance) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      rootGuidance.compareDocumentPosition(linkedTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      linkedTitle.compareDocumentPosition(timelineTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      timelineTitle.compareDocumentPosition(aiSummaryTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      aiSummaryTitle.compareDocumentPosition(actionsTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("scrolls to anchored mobile sections from top tabs（移动端顶部 tab 导航可滚动到分区）", async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(screen.getByTestId("task-mobile-section-tabs")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(10);

    fireEvent.click(screen.getByRole("tab", { name: "依赖关系" }));

    expect(document.getElementById("task-detail-dependency")).not.toBeNull();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("hides task detail scrollbars while preserving scroll containers（任务详情隐藏滚动条）", async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(screen.getByTestId("new-task-detail-page")).toHaveClass(
      "scrollbar-none",
    );
    expect(
      screen.getByTestId("task-mobile-section-tabs").firstElementChild,
    ).toHaveClass("scrollbar-none");
  });

  it("renders desktop two-column timeblock detail（桌面端双列任务详情）", async () => {
    window.history.replaceState({}, "", "/tasks/block/block-1?from=today");
    mockMatchMedia(true);
    render(<TaskDetailPage />);

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled();
    });

    expect((await screen.findAllByText("任务")).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "深度工作：EventLog 模块实现",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-detail-desktop-breadcrumb")).toHaveClass(
      "sticky",
      "top-0",
    );
    expect(
      screen.getAllByText("深度工作：EventLog 模块实现").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("事件时间线")).toBeInTheDocument();
    expect(screen.getByText("AI 总结")).toBeInTheDocument();
    expect(screen.getByText("其他操作")).toBeInTheDocument();
  });

  it("places linked blocks above timeline on desktop（关联时间块在事件时间线上方）", async () => {
    window.history.replaceState({}, "", "/tasks/block/block-1?from=today");
    mockMatchMedia(true);
    render(<TaskDetailPage />);

    await waitFor(() => {
      expect(loadTimeBlocksMock).toHaveBeenCalled();
    });

    const linkedTitle = await screen.findByText("关联时间块");
    const timelineTitle = screen.getByText("事件时间线");
    expect(
      linkedTitle.compareDocumentPosition(timelineTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows empty timeline hint when no linked blocks（无关联时间块时显示空态提示）", async () => {
    mockMatchMedia(false);
    const emptyTask = makeTask({ timeBlockIds: [] });
    getTaskMock.mockResolvedValue(emptyTask);
    listTasksMock.mockResolvedValue([emptyTask]);
    loadTimeBlocksMock.mockResolvedValue([]);
    loadEventsMock.mockResolvedValue([]);

    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");
    expect(
      screen.getByText("暂无关联时间块，开始一个时间块后即可在此查看事件。"),
    ).toBeInTheDocument();
  });

  it("renders current root guidance without DAG link（详情页复用当前根节点规则，#496 移除 DAG 链接）", async () => {
    mockMatchMedia(true);
    listTasksMock.mockResolvedValue([
      makeTask({
        id: "task-root",
        title: "优先收口 DAG 根节点",
        status: "pending",
        createdAt: 10,
        updatedAt: 10,
      }),
      makeTask({
        id: "task-3",
        title: "并行任务 A",
        status: "pending",
        createdAt: 15,
        updatedAt: 15,
      }),
      makeTask({
        id: "task-4",
        title: "并行任务 B",
        status: "pending",
        createdAt: 18,
        updatedAt: 18,
      }),
      makeTask({
        id: "task-1",
        title: "深度工作：EventLog 模块实现",
        status: "in_progress",
        createdAt: 20,
        updatedAt: 20,
      }),
      makeTask({
        id: "task-2",
        title: "切换后的任务 B",
        estimatedMinutes: 30,
        status: "pending",
        createdAt: 30,
        updatedAt: 30,
      }),
    ]);
    render(<TaskDetailPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    expect(
      await screen.findByTestId("task-current-root-card"),
    ).toHaveTextContent("优先收口 DAG 根节点");
    expect(screen.getByText("优先收口 DAG 根节点")).toBeInTheDocument();
    expect(
      screen.getByTestId("task-current-root-card-collapse-toggle"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-current-root-dag-link")).toBeNull();
  });

  it("starts countdown with task estimated minutes instead of hardcoded 25（开始计时时使用任务预估分钟数）", async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    await waitFor(() => {
      expect(
        screen.getByTestId("task-countdown-custom-trigger"),
      ).toHaveTextContent("120m");
    });

    fireEvent.click(screen.getByText("开始计时"));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith("task-1", {
        mode: "countdown",
        minutes: 120,
      });
      expect(navigateMock).toHaveBeenCalledWith({ to: "/eventlog" });
    });
  });

  it("syncs task estimated minutes into expected duration before manual timer override（任务估时会同步到预期时长）", async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    fireEvent.click(screen.getByTestId("estimated-time-preset-60"));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ estimatedMinutes: 60 }),
      );
    });

    expect(
      screen.getByTestId("task-countdown-auto-fill-switch"),
    ).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByText("开始计时"));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith("task-1", {
        mode: "countdown",
        minutes: 60,
      });
      expect(navigateMock).toHaveBeenCalledWith({ to: "/eventlog" });
    });
  });

  it("persists auto-fill switch and reapplies remaining minutes after remount（自动补全开关持久化并在回页后重新应用）", async () => {
    mockMatchMedia(false);
    const view = render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(
      screen.getByTestId("task-countdown-auto-fill-status"),
    ).toHaveTextContent("剩余 30min");
    fireEvent.click(screen.getByTestId("task-countdown-auto-fill-switch"));

    await waitFor(() => {
      expect(
        screen.getByTestId("task-countdown-auto-fill-switch"),
      ).toHaveAttribute("aria-checked", "true");
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("task-countdown-custom-trigger"),
      ).toHaveTextContent("30m");
    });

    view.unmount();
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");
    expect(
      screen.getByTestId("task-countdown-auto-fill-switch"),
    ).toHaveAttribute("aria-checked", "true");

    await waitFor(() => {
      expect(
        screen.getByTestId("task-countdown-custom-trigger"),
      ).toHaveTextContent("30m");
    });
  });

  it("routes estimated-time changes through remaining time while auto-fill is enabled（自动补全开启时按剩余时长路由任务估时变化）", async () => {
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    fireEvent.click(screen.getByTestId("task-countdown-auto-fill-switch"));
    await waitFor(() => {
      expect(
        screen.getByTestId("task-countdown-auto-fill-switch"),
      ).toHaveAttribute("aria-checked", "true");
    });

    fireEvent.click(screen.getByTestId("estimated-time-preset-60"));

    await waitFor(() => {
      expect(updateTaskMock).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ estimatedMinutes: 60 }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("task-mode-countup")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    fireEvent.click(screen.getByText("开始计时"));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith("task-1", {
        mode: "countup",
      });
      expect(navigateMock).toHaveBeenCalledWith({ to: "/eventlog" });
    });
  });

  it("resets timer config after switching to another task（切换任务后重置为新任务的初始计时配置）", async () => {
    mockMatchMedia(false);
    const { rerender } = render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    fireEvent.click(screen.getByTestId("task-mode-countup"));
    expect(screen.getByTestId("task-mode-countup")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    currentTaskId = "task-2";
    rerender(<TaskDetailPage />);

    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledWith("task-2");
    });

    await waitFor(() => {
      expect(screen.getByTestId("task-mode-countdown")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    expect(
      screen.getByTestId("task-countdown-custom-trigger"),
    ).toHaveTextContent("30m");

    fireEvent.click(screen.getByText("开始计时"));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith("task-2", {
        mode: "countdown",
        minutes: 30,
      });
      expect(navigateMock).toHaveBeenCalledWith({ to: "/eventlog" });
    });
  });

  it("hides stale timer actions while next task is still loading（切换任务加载中不允许沿用旧配置启动）", async () => {
    mockMatchMedia(false);
    getTaskMock.mockImplementation(async (id: string) => {
      if (id === "task-2") {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return makeTask({
          id: "task-2",
          title: "切换后的任务 B",
          estimatedMinutes: 30,
          status: "pending",
          createdAt: 30,
          updatedAt: 30,
        });
      }

      return makeTask({ status: "in_progress", createdAt: 20, updatedAt: 20 });
    });

    const { rerender } = render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");
    fireEvent.click(screen.getByTestId("task-mode-countup"));

    currentTaskId = "task-2";
    rerender(<TaskDetailPage />);

    expect(screen.getByText("加载中...")).toBeInTheDocument();
    expect(screen.queryByText("开始计时")).toBeNull();

    await waitFor(() => {
      expect(
        screen.getByTestId("task-countdown-custom-trigger"),
      ).toHaveTextContent("30m");
    });

    fireEvent.click(screen.getByText("开始计时"));

    await waitFor(() => {
      expect(startBlockForTaskMock).toHaveBeenCalledWith("task-2", {
        mode: "countdown",
        minutes: 30,
      });
      expect(navigateMock).toHaveBeenCalledWith({ to: "/eventlog" });
    });
  });

  it("recognizes active block through taskIds includes（通过 taskIds.includes 识别当前任务的活跃时间块）", async () => {
    loadActiveBlockMock.mockResolvedValue({
      startId: "active-1",
      name: "多任务块",
      mode: "countup",
      startTime: new Date("2026-03-06T09:00:00+08:00").getTime(),
      elapsed: 15 * 60 * 1000,
      paused: false,
      phase: "running",
      version: 1,
      taskIds: ["task-1"],
      taskAssociationLog: [],
    });
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(await screen.findByTestId("task-pause-button")).toHaveTextContent(
      "回到当下",
    );
  });

  it("switches timer controls to append-association mode when another active block exists（已有时间块时改为追加关联）", async () => {
    loadActiveBlockMock.mockResolvedValue({
      startId: "active-2",
      name: "其他任务的时间块",
      mode: "countup",
      startTime: new Date("2026-03-06T09:00:00+08:00").getTime(),
      elapsed: 15 * 60 * 1000,
      paused: false,
      phase: "running",
      version: 1,
      taskIds: ["task-root"],
      taskAssociationLog: [],
    });
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(screen.queryByText("计时时长")).toBeNull();
    expect(screen.queryByTestId("task-countdown-auto-fill-switch")).toBeNull();
    expect(
      screen.getByTestId("task-append-association-button"),
    ).toHaveTextContent("追加任务关联");
    expect(screen.getByTestId("task-pause-button")).toHaveTextContent(
      "回到当下",
    );
    expect(
      screen.getByText("当前已有时间块进行中，可将本任务追加为关联任务。"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("task-append-association-button"));

    await waitFor(() => {
      expect(addTaskToBlockMock).toHaveBeenCalledWith("task-1");
      expect(navigateMock).toHaveBeenCalledWith({ to: "/eventlog" });
    });
  });

  it("disables append-association when the task is blocked by unfinished hard dependency（被阻塞任务禁用追加关联）", async () => {
    getTaskMock.mockResolvedValue(
      makeTask({
        status: "pending",
        dependsOn: [{ taskId: "task-root", type: "hard" }],
      }),
    );
    listTasksMock.mockResolvedValue([
      makeTask({
        id: "task-root",
        title: "试用电饭锅",
        status: "pending",
        createdAt: 10,
        updatedAt: 10,
      }),
      makeTask({
        id: "task-1",
        title: "深度工作：EventLog 模块实现",
        status: "pending",
        dependsOn: [{ taskId: "task-root", type: "hard" }],
        createdAt: 20,
        updatedAt: 20,
      }),
    ]);
    loadActiveBlockMock.mockResolvedValue({
      startId: "active-2",
      name: "其他任务的时间块",
      mode: "countup",
      startTime: new Date("2026-03-06T09:00:00+08:00").getTime(),
      elapsed: 15 * 60 * 1000,
      paused: false,
      phase: "running",
      version: 1,
      taskIds: ["task-root"],
      taskAssociationLog: [],
    });
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    const appendButton = screen.getByTestId("task-append-association-button");
    expect(appendButton).toBeDisabled();
    expect(screen.getByText("硬依赖未完成：试用电饭锅")).toBeInTheDocument();

    fireEvent.click(appendButton);

    await waitFor(() => {
      expect(addTaskToBlockMock).not.toHaveBeenCalled();
    });
  });

  it("routes go-back-to-now button to focus tab（回到当下进入专注子页面）", async () => {
    loadActiveBlockMock.mockResolvedValue({
      startId: "active-1",
      name: "多任务块",
      mode: "countup",
      startTime: new Date("2026-03-06T09:00:00+08:00").getTime(),
      elapsed: 15 * 60 * 1000,
      paused: false,
      phase: "running",
      version: 1,
      taskIds: ["task-1"],
      taskAssociationLog: [],
    });
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    fireEvent.click(await screen.findByTestId("task-pause-button"));

    await waitFor(() => {
      expect(pauseBlockMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith({ to: "/eventlog" });
    });
  });

  it("uses the originating timeblock detail as the back target when return context is provided", async () => {
    window.history.replaceState(
      {},
      "",
      "/tasks/task-1?blockId=block-1&returnTo=%2Ftasks%2Fblock%2Fblock-1&returnLabel=%E6%97%B6%E9%97%B4%E5%9D%97%E8%AF%A6%E6%83%85",
    );
    mockMatchMedia(false);
    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(screen.getByLabelText("返回时间块详情")).toHaveAttribute(
      "to",
      "/tasks/block/block-1",
    );
  });

  it("keeps the task title as the primary heading when entered from a timeblock detail page", async () => {
    window.history.replaceState(
      {},
      "",
      "/tasks/task-1?blockId=block-1&returnTo=%2Ftasks%2Fblock%2Fblock-1&returnLabel=%E6%97%B6%E9%97%B4%E5%9D%97%E8%AF%A6%E6%83%85",
    );
    loadTimeBlocksMock.mockResolvedValue([
      makeBlock({
        name: "2026-03-22 洗澡",
      }),
    ]);
    mockMatchMedia(true);

    render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "深度工作：EventLog 模块实现",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("关联时间块：2026-03-22 洗澡")).toBeInTheDocument();
  });

  it("pressing Escape should cancel description editing and restore persisted text（Esc 取消描述编辑并恢复原值）", async () => {
    mockMatchMedia(false);
    const { container } = render(<TaskDetailPage />);

    await screen.findAllByText("深度工作：EventLog 模块实现");

    const editButton = container.querySelector('button[class*="p-1.5"]');
    expect(editButton).not.toBeNull();
    fireEvent.click(editButton!);

    const textarea = screen.getByPlaceholderText("输入任务描述...");
    fireEvent.change(textarea, { target: { value: "临时修改，不应保存" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("输入任务描述...")).toBeNull();
    });

    expect(updateTaskMock).not.toHaveBeenCalled();
    expect(screen.getByText("实现任务详情页首版")).toBeInTheDocument();
    expect(screen.queryByText("临时修改，不应保存")).toBeNull();
  });
});
