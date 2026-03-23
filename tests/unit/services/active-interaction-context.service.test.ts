import { beforeEach, describe, expect, it } from 'vitest';

import {
  getActiveInteractionContextService,
  resetActiveInteractionContextServiceForTests,
} from '@/lib/services/active-interaction-context.service';

describe('active-interaction-context.service（活跃交互上下文服务）', () => {
  beforeEach(() => {
    resetActiveInteractionContextServiceForTests();
  });

  it('stores and clears agent chat context（保存并清理 Agent 对话上下文）', () => {
    const service = getActiveInteractionContextService();

    service.setContext({
      targetScope: 'agent-chat',
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-001',
      },
    });

    expect(service.getContext()).toEqual({
      targetScope: 'agent-chat',
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-001',
      },
    });

    service.clearContext();

    expect(service.getContext()).toBeNull();
  });

  it('trims empty agent context fields（裁掉空白的 Agent 上下文字段）', () => {
    const service = getActiveInteractionContextService();

    service.setContext({
      targetScope: 'agent-chat',
      agentContext: {
        agentId: '  codex  ',
        agentName: '   ',
        sessionId: '',
      },
    });

    expect(service.getContext()).toEqual({
      targetScope: 'agent-chat',
      agentContext: {
        agentId: 'codex',
      },
    });
  });
});
