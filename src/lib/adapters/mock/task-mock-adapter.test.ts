import { describe, it, expect, beforeEach } from "vitest";
import { TaskMockAdapter } from "./task-mock-adapter";

describe("TaskMockAdapter", () => {
  let adapter: TaskMockAdapter;

  beforeEach(() => {
    adapter = new TaskMockAdapter();
  });

  it("listTasks() 默认不返回 cancelled 任务", async () => {
    const created = await adapter.createTask({ title: "待取消任务" });
    await adapter.transitionTask(created.id, "in_progress");
    await adapter.cancelTask(created.id);

    const tasks = await adapter.listTasks();
    expect(tasks.every((t) => t.status !== "cancelled")).toBe(true);
  });

  it("listTasks(true) 包含 cancelled 任务", async () => {
    const created = await adapter.createTask({ title: "待取消任务2" });
    await adapter.transitionTask(created.id, "in_progress");
    await adapter.cancelTask(created.id);

    const tasks = await adapter.listTasks(true);
    const cancelledTasks = tasks.filter((t) => t.status === "cancelled");
    expect(cancelledTasks.length).toBeGreaterThan(0);
  });

  it("createTask 创建后 status 为 pending，id 非空", async () => {
    const task = await adapter.createTask({ title: "新任务" });
    expect(task.id).toBeTruthy();
    expect(task.status).toBe("pending");
    expect(task.statusTransitions).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: "pending",
        reason: "task.create",
      }),
    ]);
  });

  it("updateTask 更新字段，updatedAt 变大", async () => {
    const created = await adapter.createTask({ title: "原标题" });
    const originalUpdatedAt = created.updatedAt;

    // 等待 1ms 确保时间戳有变化
    await new Promise((resolve) => setTimeout(resolve, 1));

    const updated = await adapter.updateTask(created.id, { title: "新标题" });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("新标题");
    expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  it("cancelTask 后任务 status 为 cancelled，且从 listTasks() 中消失", async () => {
    const created = await adapter.createTask({ title: "要取消的任务" });
    await adapter.transitionTask(created.id, "in_progress");
    const cancelled = await adapter.cancelTask(created.id);

    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe("cancelled");

    const tasks = await adapter.listTasks();
    expect(tasks.find((t) => t.id === created.id)).toBeUndefined();
  });

  it("transitionTask 合法转换成功", async () => {
    const created = await adapter.createTask({ title: "状态转换测试" });
    const transitioned = await adapter.transitionTask(
      created.id,
      "in_progress",
    );

    expect(transitioned).not.toBeNull();
    expect(transitioned!.status).toBe("in_progress");
    expect(transitioned!.statusTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromStatus: "pending",
          toStatus: "in_progress",
          reason: "task.transition",
        }),
      ]),
    );
  });

  it("persists transition history across get/list rereads", async () => {
    const created = await adapter.createTask({ title: "持久状态历史测试" });
    await adapter.transitionTask(created.id, "in_progress");
    const cancelled = await adapter.cancelTask(created.id);

    expect(cancelled).not.toBeNull();
    expect(cancelled!.statusTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromStatus: "in_progress",
          toStatus: "cancelled",
          reason: "task.transition",
        }),
      ]),
    );

    const reread = await adapter.getTaskById(created.id);
    expect(reread?.status).toBe("cancelled");
    expect(reread?.statusTransitions).toEqual(cancelled!.statusTransitions);

    const listed = await adapter.listTasks(true);
    expect(listed.find((task) => task.id === created.id)?.statusTransitions).toEqual(
      cancelled!.statusTransitions,
    );
  });

  it("transitionTask 非法转换抛出 Error", async () => {
    const created = await adapter.createTask({ title: "非法转换测试" });
    // pending → completed 是非法转换（必须先经过 in_progress）
    await expect(
      adapter.transitionTask(created.id, "completed"),
    ).rejects.toThrow();
  });

  it("getAvailableTransitions 对 pending 任务返回 ['in_progress']", async () => {
    const created = await adapter.createTask({ title: "可用转换测试" });
    const transitions = await adapter.getAvailableTransitions(created.id);
    expect(transitions).toEqual(["in_progress"]);
  });
});
