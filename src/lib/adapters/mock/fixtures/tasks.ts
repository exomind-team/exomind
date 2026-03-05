import type { TaskNode } from '@/lib/types/task'

const BASE_TS = new Date('2026-02-23T09:00:00.000Z').getTime()

export const MOCK_TASK_NODES_FIXTURE: TaskNode[] = [
  {
    id: 'node-001',
    title: '完成 TaskNode 数据模型',
    status: 'completed',
    priority: 'high',
    dependsOn: [],
    tags: ['architecture'],
    estimatedMinutes: 120,
    spentMinutes: 90,
    createdAt: BASE_TS,
    updatedAt: BASE_TS + 3600_000,
    completedAt: BASE_TS + 3600_000,
  },
  {
    id: 'node-002',
    title: '实现 CRUD 服务层',
    status: 'in_progress',
    priority: 'high',
    dependsOn: [{ taskId: 'node-001', type: 'hard' }],
    tags: ['backend'],
    estimatedMinutes: 180,
    spentMinutes: 30,
    createdAt: BASE_TS + 3600_000,
    updatedAt: BASE_TS + 7200_000,
  },
  {
    id: 'node-003',
    title: '编写单元测试',
    status: 'not_started',
    priority: 'medium',
    dependsOn: [{ taskId: 'node-002', type: 'soft' }],
    tags: ['test'],
    createdAt: BASE_TS + 7200_000,
    updatedAt: BASE_TS + 7200_000,
  },
]
