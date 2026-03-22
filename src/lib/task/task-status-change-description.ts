import { getEventLogService } from '@/lib/services';
import { getEventSourceMetadata } from '@/lib/eventlog/source-metadata';
import { SYSTEM_TAGS, type EventData } from '@/lib/types/event';
import type { TaskStatus } from '@/lib/types/task';
import { createUuidV4 } from '@/lib/utils/uuid';

function resolveTaskTransitionTag(status: TaskStatus): string {
  if (status === 'in_progress') return SYSTEM_TAGS.TASK_STARTED;
  if (status === 'suspended') return SYSTEM_TAGS.TASK_SUSPENDED;
  if (status === 'completed') return SYSTEM_TAGS.TASK_COMPLETED;
  return SYSTEM_TAGS.TASK_CANCELLED;
}

export async function appendTaskStatusChangeDescription(params: {
  taskId: string;
  taskTitle: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  description: string;
}): Promise<void> {
  const description = params.description.trim();
  if (!description) {
    return;
  }

  const eventData: EventData = {
    id: createUuidV4(),
    timestamp: Date.now(),
    content: `任务「${params.taskTitle}」状态变更说明：${description}`,
    tags: [SYSTEM_TAGS.NOTE, resolveTaskTransitionTag(params.toStatus)],
    metadata: {
      source: getEventSourceMetadata(),
      taskId: params.taskId,
      taskTitle: params.taskTitle,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      description,
      recordType: 'task_status_change_description',
    },
  };

  await getEventLogService().appendEventData(eventData);
}
