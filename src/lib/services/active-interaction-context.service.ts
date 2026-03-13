import type { AgentInteractionContext, TargetScope } from '@/lib/types/normalized-input';

export interface ActiveInteractionContext {
  targetScope: TargetScope;
  agentContext?: AgentInteractionContext;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAgentContext(
  agentContext: AgentInteractionContext | undefined,
): AgentInteractionContext | undefined {
  if (!agentContext) return undefined;

  const nextAgentContext: AgentInteractionContext = {
    agentId: normalizeOptionalString(agentContext.agentId),
    agentName: normalizeOptionalString(agentContext.agentName),
    sessionId: normalizeOptionalString(agentContext.sessionId),
  };

  return Object.values(nextAgentContext).some(Boolean) ? nextAgentContext : undefined;
}

function normalizeContext(context: ActiveInteractionContext): ActiveInteractionContext {
  return {
    targetScope: context.targetScope,
    agentContext: normalizeAgentContext(context.agentContext),
  };
}

export class ActiveInteractionContextService {
  private currentOwnerId: string | null = null;
  private currentContext: ActiveInteractionContext | null = null;

  setContext(context: ActiveInteractionContext, ownerId = 'default'): void {
    this.currentOwnerId = ownerId;
    this.currentContext = normalizeContext(context);
  }

  getContext(): ActiveInteractionContext | null {
    if (!this.currentContext) return null;
    return {
      targetScope: this.currentContext.targetScope,
      agentContext: this.currentContext.agentContext
        ? { ...this.currentContext.agentContext }
        : undefined,
    };
  }

  clearContext(ownerId = 'default'): void {
    if (this.currentOwnerId !== ownerId) return;
    this.currentOwnerId = null;
    this.currentContext = null;
  }
}

let activeInteractionContextServiceInstance: ActiveInteractionContextService | null = null;

export function getActiveInteractionContextService(): ActiveInteractionContextService {
  if (!activeInteractionContextServiceInstance) {
    activeInteractionContextServiceInstance = new ActiveInteractionContextService();
  }
  return activeInteractionContextServiceInstance;
}

export function resetActiveInteractionContextServiceForTests(): void {
  activeInteractionContextServiceInstance = null;
}
