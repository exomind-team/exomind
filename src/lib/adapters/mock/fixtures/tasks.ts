import {
  buildInitialTaskStatusTransition,
  type TaskNode,
} from "@/lib/types/task";

const BASE_TS = new Date("2026-02-23T09:00:00.000Z").getTime();

export const MOCK_TASK_NODES_FIXTURE: TaskNode[] = [
  {
    id: "node-001",
    title: "完成 TaskNode 数据模型",
    status: "completed",
    priority: "high",
    dependsOn: [],
    tags: ["architecture"],
    estimatedMinutes: 120,
    statusTransitions: [
      buildInitialTaskStatusTransition("node-001", BASE_TS),
      {
        id: "node-001:task.transition:in_progress:1740303000000:1",
        at: BASE_TS + 1800_000,
        fromStatus: "pending",
        toStatus: "in_progress",
        reason: "task.transition",
      },
      {
        id: "node-001:task.transition:completed:1740304800000:2",
        at: BASE_TS + 3600_000,
        fromStatus: "in_progress",
        toStatus: "completed",
        reason: "task.transition",
      },
    ],
    createdAt: BASE_TS,
    updatedAt: BASE_TS + 3600_000,
    completedAt: BASE_TS + 3600_000,
  },
  {
    id: "node-002",
    title: "实现 CRUD 服务层",
    status: "in_progress",
    priority: "high",
    dependsOn: [{ taskId: "node-001", type: "hard" }],
    tags: ["backend"],
    estimatedMinutes: 180,
    statusTransitions: [
      buildInitialTaskStatusTransition("node-002", BASE_TS + 3600_000),
      {
        id: "node-002:task.transition:in_progress:1740306600000:1",
        at: BASE_TS + 5400_000,
        fromStatus: "pending",
        toStatus: "in_progress",
        reason: "task.transition",
      },
    ],
    createdAt: BASE_TS + 3600_000,
    updatedAt: BASE_TS + 7200_000,
  },
  {
    id: "node-003",
    title: "编写单元测试",
    status: "pending",
    priority: "medium",
    dependsOn: [{ taskId: "node-002", type: "soft" }],
    tags: ["test"],
    statusTransitions: [
      buildInitialTaskStatusTransition("node-003", BASE_TS + 7200_000),
    ],
    createdAt: BASE_TS + 7200_000,
    updatedAt: BASE_TS + 7200_000,
  },
];
