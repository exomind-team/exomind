import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskRtAdapter } from "@/lib/adapters/task-rt-adapter";
import {
  createLocalProfile,
  setProfileSession,
} from "@/lib/profile/profile-storage";

function activateProfileScope(): string {
  const profile = createLocalProfile({
    slug: "exomind",
    displayName: "Hailay",
  });
  setProfileSession({
    version: 1,
    activeProfileId: profile.profileId,
    unlockedProfileIds: [profile.profileId],
  });
  return profile.profileId;
}

describe("TaskRtAdapter（RT 任务适配器）", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("maps runtime task payload to frontend TaskNode", async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: "task-1",
          title: "RT Task",
          description: "from runtime",
          done_condition: "ship feature",
          status: "pending",
          priority: "high",
          tags: ["rt"],
          source: "runtime:test",
          parent_id: "parent-1",
          depends_on: [{ task_id: "dep-1", type: "hard" }],
          due_at: 1700000000000,
          estimated_minutes: 45,
          time_block_ids: ["block-1"],
          status_transitions: [
            {
              id: "task-1:task.create:1700000000001",
              at: 1700000000001,
              from_status: null,
              to_status: "pending",
              reason: "task.create",
            },
          ],
          created_at: 1700000000001,
          updated_at: 1700000000002,
          completed_at: null,
        },
      ],
    }));

    const adapter = new TaskRtAdapter({
      fetchImpl,
      resolveTarget: () => ({
        mode: "embedded",
        host: "127.0.0.1",
        port: 9124,
      }),
    });

    const tasks = await adapter.listTasks(true);

    expect(tasks).toEqual([
      {
        id: "task-1",
        title: "RT Task",
        description: "from runtime",
        doneCondition: "ship feature",
        status: "pending",
        priority: "high",
        tags: ["rt"],
        source: "runtime:test",
        parentId: "parent-1",
        dependsOn: [{ taskId: "dep-1", type: "hard" }],
        dueAt: 1700000000000,
        estimatedMinutes: 45,
        timeBlockIds: ["block-1"],
        statusTransitions: [
          {
            id: "task-1:task.create:1700000000001",
            at: 1700000000001,
            fromStatus: null,
            toStatus: "pending",
            reason: "task.create",
          },
        ],
        createdAt: 1700000000001,
        updatedAt: 1700000000002,
      },
    ]);
    const [requestUrl] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe("http://127.0.0.1:9124/tasks");
    expect(url.searchParams.get("user_id")).toBe(profileId);
  });

  it("serializes frontend task updates to runtime payload", async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "task-1",
        title: "Updated Task",
        description: "from runtime",
        done_condition: "ship feature",
        status: "pending",
        priority: "medium",
        tags: ["rt"],
        source: "runtime:test",
        parent_id: "parent-1",
        depends_on: [{ task_id: "dep-1", type: "soft" }],
        due_at: null,
        estimated_minutes: 25,
        time_block_ids: ["block-1", "block-2"],
        status_transitions: [],
        created_at: 1700000000001,
        updated_at: 1700000000002,
        completed_at: null,
      }),
    }));

    const adapter = new TaskRtAdapter({
      fetchImpl,
      resolveTarget: () => ({
        mode: "embedded",
        host: "127.0.0.1",
        port: 9124,
      }),
    });

    await adapter.updateTask("task-1", {
      doneCondition: "ship feature",
      dependsOn: [{ taskId: "dep-1", type: "soft" }],
      timeBlockIds: ["block-1", "block-2"],
      estimatedMinutes: 25,
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "http://127.0.0.1:9124/tasks/task-1",
    );
    expect(url.searchParams.get("user_id")).toBe(profileId);
    expect(requestInit?.method).toBe("PUT");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      done_condition: "ship feature",
      depends_on: [{ task_id: "dep-1", type: "soft" }],
      time_block_ids: ["block-1", "block-2"],
      estimated_minutes: 25,
    });
  });

  it("uses the cancel endpoint and normalizes legacy runtime status aliases", async () => {
    const profileId = activateProfileScope();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "task-2",
        title: "Cancelled Task",
        status: "abandoned",
        priority: "medium",
        tags: [],
        depends_on: [],
        time_block_ids: [],
        status_transitions: [
          {
            id: "task-2:task.transition:1700000000200",
            at: 1700000000200,
            from_status: "in_progress",
            to_status: "abandoned",
            reason: "task.transition",
          },
        ],
        created_at: 1700000000100,
        updated_at: 1700000000200,
        completed_at: 1700000000200,
      }),
    }));

    const adapter = new TaskRtAdapter({
      fetchImpl,
      resolveTarget: () => ({
        mode: "embedded",
        host: "127.0.0.1",
        port: 9124,
      }),
    });

    const task = await adapter.cancelTask("task-2");

    expect(task?.status).toBe("cancelled");
    expect(task?.statusTransitions?.[0]).toEqual(
      expect.objectContaining({
        fromStatus: "in_progress",
        toStatus: "cancelled",
      }),
    );
    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const url = new URL(requestUrl);
    expect(`${url.origin}${url.pathname}`).toBe(
      "http://127.0.0.1:9124/tasks/task-2/cancel",
    );
    expect(url.searchParams.get("user_id")).toBe(profileId);
    expect(requestInit?.method).toBe("POST");
  });

  it("serializes statusTransitions in replication upsert payload", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "updated" }),
    }));

    const adapter = new TaskRtAdapter({
      fetchImpl,
      resolveTarget: () => ({
        mode: "embedded",
        host: "127.0.0.1",
        port: 9124,
      }),
    });

    await adapter.applyReplicationSnapshot({
      id: "task-3",
      title: "Replicated task",
      status: "in_progress",
      priority: "medium",
      dependsOn: [],
      tags: [],
      timeBlockIds: ["block-3"],
      statusTransitions: [
        {
          id: "task-3:task.create:1700000001000",
          at: 1700000001000,
          fromStatus: null,
          toStatus: "pending",
          reason: "task.create",
        },
        {
          id: "task-3:task.transition:1700000002000",
          at: 1700000002000,
          fromStatus: "pending",
          toStatus: "in_progress",
          reason: "task.transition",
          operationId: "op-1",
          sourceHostId: "desktop-host",
        },
      ],
      createdAt: 1700000001000,
      updatedAt: 1700000002000,
    });

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      task: {
        id: "task-3",
        title: "Replicated task",
        description: null,
        done_condition: null,
        status: "in_progress",
        priority: "medium",
        tags: [],
        source: null,
        parent_id: null,
        depends_on: [],
        due_at: null,
        estimated_minutes: null,
        time_block_ids: ["block-3"],
        status_transitions: [
          {
            id: "task-3:task.create:1700000001000",
            at: 1700000001000,
            from_status: null,
            to_status: "pending",
            reason: "task.create",
            actor_id: null,
            source_host_id: null,
            operation_id: null,
            related_time_block_id: null,
            related_time_block_transition_ref: null,
            auto_generated: null,
          },
          {
            id: "task-3:task.transition:1700000002000",
            at: 1700000002000,
            from_status: "pending",
            to_status: "in_progress",
            reason: "task.transition",
            actor_id: null,
            source_host_id: "desktop-host",
            operation_id: "op-1",
            related_time_block_id: null,
            related_time_block_transition_ref: null,
            auto_generated: null,
          },
        ],
        created_at: 1700000001000,
        updated_at: 1700000002000,
        completed_at: null,
      },
      source_host_id: undefined,
    });
  });
});
