import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskNode, TaskStatusTransition } from "@/lib/types/task";
import { buildInitialTaskStatusTransition } from "@/lib/types/task";
import {
  buildTaskTimelineModel,
  resolveTimeRange,
} from "@/ui/app/pages/task-timeline-model";

function makeTransition(
  input: Omit<TaskStatusTransition, "id"> & { id?: string },
): TaskStatusTransition {
  return {
    ...input,
    id: input.id ?? `${input.toStatus}:${input.at}`,
  };
}

function makeTask(
  overrides: Partial<TaskNode> & Pick<TaskNode, "id" | "title" | "status">,
): TaskNode {
  const baseTime = new Date("2026-03-19T09:00:00.000+08:00").getTime();
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status,
    priority: "medium",
    dependsOn: [],
    tags: [],
    statusTransitions: overrides.statusTransitions ?? [
      buildInitialTaskStatusTransition(overrides.id, baseTime),
    ],
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

describe("task-timeline-model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveTimeRange", () => {
    it("resolves 1d to the full current day window", () => {
      const now = new Date("2026-03-19T14:30:00.000+08:00").getTime();
      expect(resolveTimeRange("1d", now)).toEqual({
        start: new Date("2026-03-19T00:00:00.000+08:00").getTime(),
        end: new Date("2026-03-19T23:59:59.999+08:00").getTime(),
      });
    });

    it("resolves 3d as the recent three full days window", () => {
      const now = new Date("2026-03-19T14:30:00.000+08:00").getTime();
      expect(resolveTimeRange("3d", now)).toEqual({
        start: new Date("2026-03-17T00:00:00.000+08:00").getTime(),
        end: new Date("2026-03-19T23:59:59.999+08:00").getTime(),
      });
    });

    it("resolves custom day scale as trailing full days ending today", () => {
      const now = new Date("2026-03-19T14:30:00.000+08:00").getTime();
      expect(
        resolveTimeRange({ kind: "custom", value: 5, unit: "d" }, now),
      ).toEqual({
        start: new Date("2026-03-15T00:00:00.000+08:00").getTime(),
        end: new Date("2026-03-19T23:59:59.999+08:00").getTime(),
      });
    });

    it("resolves custom hour scale as trailing hours ending now", () => {
      const now = new Date("2026-03-19T14:30:00.000+08:00").getTime();
      expect(
        resolveTimeRange({ kind: "custom", value: 6, unit: "h" }, now),
      ).toEqual({
        start: new Date("2026-03-19T08:30:00.000+08:00").getTime(),
        end: now,
      });
    });

    it("resolves month and year scales to calendar boundaries", () => {
      const now = new Date("2026-03-19T14:30:00.000+08:00").getTime();
      expect(resolveTimeRange("1m", now)).toEqual({
        start: new Date("2026-03-01T00:00:00.000+08:00").getTime(),
        end: new Date("2026-03-31T23:59:59.999+08:00").getTime(),
      });
      expect(
        resolveTimeRange({ kind: "custom", value: 2, unit: "y" }, now),
      ).toEqual({
        start: new Date("2025-01-01T00:00:00.000+08:00").getTime(),
        end: new Date("2026-12-31T23:59:59.999+08:00").getTime(),
      });
    });
  });

  describe("buildTaskTimelineModel", () => {
    it("builds exact segments from task status transitions", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-1",
        title: "精确历史任务",
        status: "completed",
        createdAt: new Date("2026-03-19T09:00:00.000+08:00").getTime(),
        updatedAt: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
        completedAt: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-1",
            new Date("2026-03-19T09:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            at: new Date("2026-03-19T09:30:00.000+08:00").getTime(),
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-19T10:30:00.000+08:00").getTime(),
            fromStatus: "in_progress",
            toStatus: "suspended",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
            fromStatus: "suspended",
            toStatus: "completed",
            reason: "timeblock.end",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries).toHaveLength(1);
      expect(model.entries[0]?.segments).toEqual([
        expect.objectContaining({
          status: "pending",
          startTime: new Date("2026-03-19T09:00:00.000+08:00").getTime(),
          endTime: new Date("2026-03-19T09:30:00.000+08:00").getTime(),
        }),
        expect.objectContaining({
          status: "in_progress",
          startTime: new Date("2026-03-19T09:30:00.000+08:00").getTime(),
          endTime: new Date("2026-03-19T10:30:00.000+08:00").getTime(),
        }),
        expect.objectContaining({
          status: "suspended",
          startTime: new Date("2026-03-19T10:30:00.000+08:00").getTime(),
          endTime: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
        }),
      ]);
      expect(model.entries[0]?.terminalMarker).toEqual(
        expect.objectContaining({
          status: "completed",
          timestamp: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
        }),
      );
    });

    it("hides pending segments by default", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-2",
        title: "隐藏待办任务",
        status: "in_progress",
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-2",
            new Date("2026-03-19T08:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            at: new Date("2026-03-19T09:00:00.000+08:00").getTime(),
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d");

      expect(model.entries[0]?.segments).toHaveLength(1);
      expect(model.entries[0]?.segments[0]?.status).toBe("in_progress");
    });

    it("skips tasks without status transition history", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-3",
        title: "无历史任务",
        status: "pending",
        statusTransitions: [],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries).toEqual([]);
    });

    it("derives current status from transition history instead of conflicting snapshot fields", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-conflict",
        title: "快照冲突任务",
        status: "cancelled",
        updatedAt: new Date("2026-03-19T19:30:00.000+08:00").getTime(),
        completedAt: new Date("2026-03-19T19:30:00.000+08:00").getTime(),
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-conflict",
            new Date("2026-03-19T08:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            at: new Date("2026-03-19T09:00:00.000+08:00").getTime(),
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-19T10:00:00.000+08:00").getTime(),
            fromStatus: "in_progress",
            toStatus: "suspended",
            reason: "timeblock.pause",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries[0]?.currentStatus).toBe("suspended");
      expect(model.entries[0]?.terminalMarker).toBeNull();
      expect(model.entries[0]?.segments.at(-1)?.status).toBe("suspended");
    });

    it("ignores stale terminal markers when a later transition restores a non-terminal state", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-terminal-then-active",
        title: "终态后又恢复的脏历史任务",
        status: "suspended",
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-terminal-then-active",
            new Date("2026-03-19T08:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            at: new Date("2026-03-19T09:00:00.000+08:00").getTime(),
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-19T10:00:00.000+08:00").getTime(),
            fromStatus: "in_progress",
            toStatus: "completed",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
            fromStatus: "completed",
            toStatus: "suspended",
            reason: "task.transition",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries[0]?.currentStatus).toBe("suspended");
      expect(model.entries[0]?.terminalMarker).toBeNull();
      expect(model.entries[0]?.segments.at(-1)).toEqual(
        expect.objectContaining({
          status: "suspended",
          startTime: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
        }),
      );
    });

    it("keeps equal-timestamp transitions in history order", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const transitionAt = new Date("2026-03-19T10:00:00.000+08:00").getTime();

      const task = makeTask({
        id: "task-same-ms",
        title: "同毫秒历史任务",
        status: "completed",
        completedAt: transitionAt,
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-same-ms",
            new Date("2026-03-19T09:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            id: "task-same-ms:task.transition:in_progress:10000:1",
            at: transitionAt,
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
          makeTransition({
            id: "task-same-ms:task.transition:completed:10000:2",
            at: transitionAt,
            fromStatus: "in_progress",
            toStatus: "completed",
            reason: "task.transition",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries[0]?.currentStatus).toBe("completed");
      expect(model.entries[0]?.terminalMarker).toEqual(
        expect.objectContaining({
          status: "completed",
          timestamp: transitionAt,
        }),
      );
    });

    it("keeps the latest live segment visible when it starts at the render timestamp", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-live-now",
        title: "刚开始的任务",
        status: "in_progress",
        updatedAt: now,
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-live-now",
            new Date("2026-03-19T19:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            at: now,
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries).toHaveLength(1);
      expect(model.entries[0]?.currentStatus).toBe("in_progress");
      expect(model.entries[0]?.segments.at(-1)).toEqual(
        expect.objectContaining({
          status: "in_progress",
          startTime: now,
          endTime: now + 1,
        }),
      );
    });

    it("uses the latest terminal transition when history contains conflicting terminal markers", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-terminal-conflict",
        title: "终态冲突任务",
        status: "completed",
        completedAt: new Date("2026-03-19T10:00:00.000+08:00").getTime(),
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-terminal-conflict",
            new Date("2026-03-19T08:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            at: new Date("2026-03-19T09:00:00.000+08:00").getTime(),
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-19T10:00:00.000+08:00").getTime(),
            fromStatus: "in_progress",
            toStatus: "completed",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
            fromStatus: "in_progress",
            toStatus: "cancelled",
            reason: "task.transition",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries[0]?.currentStatus).toBe("cancelled");
      expect(model.entries[0]?.terminalMarker).toEqual(
        expect.objectContaining({
          status: "cancelled",
          timestamp: new Date("2026-03-19T11:00:00.000+08:00").getTime(),
        }),
      );
    });

    it("keeps full history in the model when scale is 1d", () => {
      const now = new Date("2026-03-19T20:00:00.000+08:00").getTime();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const task = makeTask({
        id: "task-4",
        title: "历史任务",
        status: "completed",
        createdAt: new Date("2026-03-16T08:00:00.000+08:00").getTime(),
        updatedAt: new Date("2026-03-16T11:00:00.000+08:00").getTime(),
        completedAt: new Date("2026-03-16T11:00:00.000+08:00").getTime(),
        statusTransitions: [
          buildInitialTaskStatusTransition(
            "task-4",
            new Date("2026-03-16T08:00:00.000+08:00").getTime(),
          ),
          makeTransition({
            at: new Date("2026-03-16T09:00:00.000+08:00").getTime(),
            fromStatus: "pending",
            toStatus: "in_progress",
            reason: "task.transition",
          }),
          makeTransition({
            at: new Date("2026-03-16T11:00:00.000+08:00").getTime(),
            fromStatus: "in_progress",
            toStatus: "completed",
            reason: "task.transition",
          }),
        ],
      });

      const model = buildTaskTimelineModel([task], "1d", { showPending: true });

      expect(model.entries).toHaveLength(1);
      expect(model.timeRange).toEqual({
        start: new Date("2026-03-16T08:00:00.000+08:00").getTime(),
        end: new Date("2026-03-16T11:00:00.000+08:00").getTime(),
      });
    });
  });
});
