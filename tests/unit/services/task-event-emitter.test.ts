import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emitTaskCreated,
  emitTaskLinked,
  emitTaskTransition,
  emitTaskUnlinked,
} from '@/lib/services/task-event-emitter'
import { SYSTEM_TAGS } from '@/lib/types/event'
import { appendEventWithEcsReplication } from '@/lib/services/ecs-eventlog-replication.service'

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: vi.fn().mockResolvedValue({}),
}))

const appendEventWithEcsReplicationMock = vi.mocked(appendEventWithEcsReplication)

describe('task-event-emitter', () => {
  beforeEach(() => {
    appendEventWithEcsReplicationMock.mockReset()
    appendEventWithEcsReplicationMock.mockResolvedValue({})
  })

  it('emits task_created through ECS replication payload', () => {
    emitTaskCreated('task-1', '写代码')

    expect(appendEventWithEcsReplicationMock).toHaveBeenCalledWith(expect.objectContaining({
      type: SYSTEM_TAGS.TASK_CREATED,
      content: '创建任务「写代码」',
      createdAt: expect.any(String),
      metadata: expect.objectContaining({
        taskId: 'task-1',
        taskTitle: '写代码',
        source: expect.any(Object),
      }),
    }))
  })

  it('emits task_started for pending -> in_progress', () => {
    emitTaskTransition('task-1', '写代码', 'pending', 'in_progress')

    expect(appendEventWithEcsReplicationMock).toHaveBeenCalledWith(expect.objectContaining({
      type: SYSTEM_TAGS.TASK_STARTED,
      content: '开始任务「写代码」',
      metadata: expect.objectContaining({
        taskId: 'task-1',
        fromStatus: 'pending',
        toStatus: 'in_progress',
      }),
    }))
  })

  it('emits task_resumed for suspended -> in_progress', () => {
    emitTaskTransition('task-1', '写代码', 'suspended', 'in_progress')

    expect(appendEventWithEcsReplicationMock).toHaveBeenCalledWith(expect.objectContaining({
      type: SYSTEM_TAGS.TASK_RESUMED,
      content: '恢复任务「写代码」',
      metadata: expect.objectContaining({
        fromStatus: 'suspended',
        toStatus: 'in_progress',
      }),
    }))
  })

  it('emits task_linked with block metadata', () => {
    emitTaskLinked('task-1', '写代码', 'block-1', '深度工作')

    expect(appendEventWithEcsReplicationMock).toHaveBeenCalledWith(expect.objectContaining({
      type: SYSTEM_TAGS.TASK_LINKED,
      content: '关联任务「写代码」到时间块',
      metadata: expect.objectContaining({
        taskId: 'task-1',
        blockId: 'block-1',
        blockName: '深度工作',
      }),
    }))
  })

  it('emits task_unlinked with block metadata', () => {
    emitTaskUnlinked('task-1', '写代码', 'block-1', '深度工作')

    expect(appendEventWithEcsReplicationMock).toHaveBeenCalledWith(expect.objectContaining({
      type: SYSTEM_TAGS.TASK_UNLINKED,
      content: '取消关联任务「写代码」',
      metadata: expect.objectContaining({
        taskId: 'task-1',
        blockId: 'block-1',
      }),
    }))
  })

  it('swallows ECS replication errors', () => {
    appendEventWithEcsReplicationMock.mockRejectedValueOnce(new Error('boom'))

    expect(() => emitTaskCreated('task-1', '写代码')).not.toThrow()
  })
})
