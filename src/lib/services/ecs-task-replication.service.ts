import { TaskRtAdapter } from '@/lib/adapters/task-rt-adapter';
import { getCurrentProfileOrLegacyId } from '@/lib/profile/profile-storage';
import {
  normalizeTaskNode,
  type TaskNode,
  type TaskNodeLike,
} from '@/lib/types/task';

export const TASK_REPLICATION_UPSERTED_TOPIC = 'task.replication.upserted';

export interface TaskReplicationCursor {
  kind: 'task_snapshot';
  taskId: string;
  updatedAt: number;
  originHostId?: string;
}

export interface TaskReplicationUpsertedPayload {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: TaskReplicationCursor;
  task: TaskNode | RuntimeTaskReplicationPayload;
}

interface RuntimeTaskReplicationPayload {
  id: string;
  title: string;
  description?: string | null;
  status: TaskNode['status'];
  priority: TaskNode['priority'];
  tags?: string[];
  depends_on?: Array<{
    task_id: string;
    type: 'soft' | 'hard';
  }>;
  time_block_ids?: string[];
  created_at: number;
  updated_at: number;
  completed_at?: number | null;
}

function normalizeReplicatedTask(
  task: TaskNode | RuntimeTaskReplicationPayload,
): TaskNode {
  if ('dependsOn' in task || 'createdAt' in task || 'updatedAt' in task) {
    return normalizeTaskNode(task as TaskNodeLike);
  }

  return normalizeTaskNode({
    id: task.id,
    title: task.title,
    description: task.description ?? undefined,
    status: task.status,
    priority: task.priority,
    tags: task.tags ?? [],
    dependsOn: (task.depends_on ?? []).map((dependency) => ({
      taskId: dependency.task_id,
      type: dependency.type,
    })),
    timeBlockIds: task.time_block_ids ?? [],
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at ?? undefined,
  } satisfies TaskNodeLike);
}

export type ProjectReplicatedTaskResult = 'inserted' | 'updated' | 'ignored';

export async function projectTaskReplicationUpsert(
  payload: TaskReplicationUpsertedPayload,
  userId?: string,
): Promise<ProjectReplicatedTaskResult> {
  const currentScopeKey = userId ?? getCurrentProfileOrLegacyId();
  if (typeof payload.scopeKey === 'string' && payload.scopeKey.length > 0 && payload.scopeKey !== currentScopeKey) {
    return 'ignored';
  }

  const adapter = new TaskRtAdapter();
  return adapter.applyReplicationSnapshot(
    normalizeReplicatedTask(payload.task),
    payload.cursor.originHostId,
  );
}
