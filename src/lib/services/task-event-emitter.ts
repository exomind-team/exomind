import { getEventSourceMetadata } from '@/lib/eventlog/source-metadata'
import { SYSTEM_TAGS } from '@/lib/types/event'
import { createUuidV4 } from '@/lib/utils/uuid'
import { appendEventWithEcsReplication } from './ecs-eventlog-replication.service'

function tryEmit(type: string, content: string, metadata: Record<string, unknown>): void {
  void appendEventWithEcsReplication({
    id: createUuidV4(),
    content,
    createdAt: new Date().toISOString(),
    type,
    metadata: {
      source: getEventSourceMetadata(),
      ...metadata,
    },
  }).catch(() => {
    // EventLog 写入失败不应阻塞任务主流程
  })
}

export function emitTaskCreated(taskId: string, taskTitle: string): void {
  tryEmit(
    SYSTEM_TAGS.TASK_CREATED,
    `创建任务「${taskTitle}」`,
    { taskId, taskTitle },
  )
}

export function emitTaskTransition(
  taskId: string,
  taskTitle: string,
  fromStatus: string,
  toStatus: string,
): void {
  const transitionLabels: Record<string, { tag: string; verb: string } | undefined> = {
    in_progress: { tag: SYSTEM_TAGS.TASK_STARTED, verb: '开始' },
    suspended: { tag: SYSTEM_TAGS.TASK_SUSPENDED, verb: '挂起' },
    completed: { tag: SYSTEM_TAGS.TASK_COMPLETED, verb: '完成' },
    cancelled: { tag: SYSTEM_TAGS.TASK_CANCELLED, verb: '取消' },
  }

  const eventDescriptor = fromStatus === 'suspended' && toStatus === 'in_progress'
    ? { tag: SYSTEM_TAGS.TASK_RESUMED, verb: '恢复' }
    : transitionLabels[toStatus]

  if (!eventDescriptor) {
    return
  }

  tryEmit(
    eventDescriptor.tag,
    `${eventDescriptor.verb}任务「${taskTitle}」`,
    { taskId, taskTitle, fromStatus, toStatus },
  )
}

export function emitTaskLinked(
  taskId: string,
  taskTitle: string,
  blockId: string,
  blockName?: string,
): void {
  tryEmit(
    SYSTEM_TAGS.TASK_LINKED,
    `关联任务「${taskTitle}」到时间块`,
    { taskId, taskTitle, blockId, blockName },
  )
}

export function emitTaskUnlinked(
  taskId: string,
  taskTitle: string,
  blockId: string,
  blockName?: string,
): void {
  tryEmit(
    SYSTEM_TAGS.TASK_UNLINKED,
    `取消关联任务「${taskTitle}」`,
    { taskId, taskTitle, blockId, blockName },
  )
}
