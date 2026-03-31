import { describe, expect, it } from 'vitest';

import type { SessionInfo } from '@/lib/types/session';
import {
  buildWorkbenchSessionProjection,
  mergeWorkbenchLegacyIntentIntoProjection,
  type WorkbenchLegacyIntent,
} from '@/ui/app/pages/workbench/workbench-session-interop';

function buildSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-789',
    agent_kind: 'claude',
    agent_id: 'agent-789',
    role: 'Planner Agent',
    summary: 'Plan the next workbench slice',
    status: 'running',
    interaction_mode: 'structured',
    context: {
      issue_refs: ['#789'],
      labels: ['workbench'],
    },
    created_at: '2026-03-31T09:00:00.000Z',
    last_active_at: '2026-03-31T09:30:00.000Z',
    turn_count: 5,
    last_output_preview: 'Adapter ready',
    ...overrides,
  };
}

describe('Issue #789 session-runtime federation（会话/运行时联邦桥接）', () => {
  it('maps structured sessions into session objects with agent-session bindings（结构化会话映射为 SessionObject 和 agent-session 绑定）', () => {
    const projection = buildWorkbenchSessionProjection([
      buildSession({
        id: 'session-structured',
        role: 'Review Agent',
        agent_id: 'agent-review',
        interaction_mode: 'structured',
      }),
    ]);

    expect(projection.sessions).toHaveLength(1);
    expect(projection.sessions[0]).toMatchObject({
      id: 'session-structured',
      sessionKind: 'agent',
      interactionMode: 'structured',
      title: 'Review Agent',
      status: 'running',
    });

    expect(projection.bindings).toHaveLength(1);
    expect(projection.bindings[0]).toMatchObject({
      sessionId: 'session-structured',
      bindingType: 'agent-session',
      runtimeRef: 'agent:agent-review',
      hostId: undefined,
    });
  });

  it('maps terminal PTY sessions into runtime bindings（终端 PTY 会话映射为运行时绑定）', () => {
    const projection = buildWorkbenchSessionProjection([
      buildSession({
        id: 'session-terminal',
        interaction_mode: 'terminal',
        pty_id: 'pty-789',
        source_host_id: 'host-a',
        source_host_address: '127.0.0.1:9124',
        agent_id: undefined,
        role: 'Terminal Runner',
      }),
    ]);

    expect(projection.sessions[0]).toMatchObject({
      id: 'session-terminal',
      sessionKind: 'terminal',
      interactionMode: 'terminal',
      title: 'Terminal Runner',
    });

    expect(projection.bindings[0]).toMatchObject({
      sessionId: 'session-terminal',
      bindingType: 'pty-runtime',
      runtimeRef: 'pty-789',
      runtimeKey: 'host-a::pty-789',
      hostId: 'host-a',
      hostAddress: '127.0.0.1:9124',
    });
  });

  it('maps terminal non-PTY sessions into ssh bindings（无 PTY 的终端会话映射为 SSH 绑定）', () => {
    const projection = buildWorkbenchSessionProjection([
      buildSession({
        id: 'session-ssh',
        interaction_mode: 'terminal',
        pty_id: undefined,
        source_host_id: 'host-b',
        source_host_address: '192.168.1.40:1949',
        agent_id: undefined,
        role: 'SSH Session',
      }),
    ]);

    expect(projection.bindings[0]).toMatchObject({
      sessionId: 'session-ssh',
      bindingType: 'ssh-runtime',
      runtimeRef: 'session:session-ssh',
      runtimeKey: 'host-b::session-ssh',
      hostId: 'host-b',
    });
  });

  it('preserves legacy chat handoff when runtime sessions are non-empty（runtime 非空时仍保留旧聊天 handoff）', () => {
    const legacyIntent: WorkbenchLegacyIntent = {
      source: 'agent-chat',
      route: '/agents/chat/agent-review',
      agentId: 'agent-review',
    };

    const projection = mergeWorkbenchLegacyIntentIntoProjection(
      buildWorkbenchSessionProjection([
        buildSession({
          id: 'session-review',
          role: 'Review Agent',
          agent_id: 'agent-review',
        }),
        buildSession({
          id: 'session-terminal',
          interaction_mode: 'terminal',
          pty_id: 'pty-789',
          agent_id: undefined,
          role: 'Terminal Runner',
        }),
      ]),
      legacyIntent,
    );

    expect(projection.activeLegacySessionId).toBe('session-review');
    expect(projection.sessions[0]).toMatchObject({
      id: 'session-review',
      title: 'Agent Chat / agent-review',
      legacyIntent: {
        route: '/agents/chat/agent-review',
        agentId: 'agent-review',
      },
    });
  });
});
