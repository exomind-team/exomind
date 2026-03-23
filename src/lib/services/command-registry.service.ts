import type {
  CommandAvailability,
  CommandCandidate,
  CommandContext,
  CommandDefinition,
  CommandId,
  CommandResult,
} from '@/lib/types/command-palette';

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function toArray(values?: string[]): string[] {
  if (!values) return [];
  return values.filter((value) => value.trim().length > 0);
}

function resolveAvailability(availability: CommandAvailability | undefined): { available: boolean; reason?: string } {
  if (availability === undefined) {
    return { available: true };
  }

  if (typeof availability === 'boolean') {
    return {
      available: availability,
      reason: availability ? undefined : '当前不可用',
    };
  }

  return {
    available: Boolean(availability.available),
    reason: availability.reason,
  };
}

function scoreCommand(definition: CommandDefinition<unknown>, query: string): number {
  if (!query) return 0;

  const normalizedId = normalizeText(definition.id);
  const normalizedTitle = normalizeText(definition.title);
  const aliases = toArray(definition.aliases).map(normalizeText);
  const keywords = toArray(definition.keywords).map(normalizeText);

  let score = 0;

  if (normalizedId === query) score = Math.max(score, 480);
  if (normalizedTitle === query) score = Math.max(score, 440);

  if (normalizedTitle.startsWith(query)) score = Math.max(score, 360);
  if (aliases.some((alias) => alias.startsWith(query))) score = Math.max(score, 340);
  if (keywords.some((keyword) => keyword.startsWith(query))) score = Math.max(score, 320);

  if (normalizedId.includes(query)) score = Math.max(score, 280);
  if (normalizedTitle.includes(query)) score = Math.max(score, 260);
  if (aliases.some((alias) => alias.includes(query))) score = Math.max(score, 240);
  if (keywords.some((keyword) => keyword.includes(query))) score = Math.max(score, 220);

  return score;
}

function sortCandidates(left: CommandCandidate, right: CommandCandidate): number {
  if (left.available !== right.available) {
    return left.available ? -1 : 1;
  }

  if (left.score !== right.score) {
    return right.score - left.score;
  }

  return left.title.localeCompare(right.title, 'zh-CN');
}

function toCandidate(
  definition: CommandDefinition<unknown>,
  context: CommandContext,
  query: string,
): CommandCandidate | null {
  const availability = resolveAvailability(definition.isAvailable?.(context));
  const normalizedQuery = normalizeText(query);
  const score = scoreCommand(definition, normalizedQuery);

  if (normalizedQuery && score <= 0) {
    return null;
  }

  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    category: definition.category,
    permissionTier: definition.permissionTier,
    aliases: toArray(definition.aliases),
    keywords: toArray(definition.keywords),
    available: availability.available,
    reason: availability.reason,
    score,
  };
}

export interface CommandRegistryService {
  setCommands(scope: string, commands: CommandDefinition[]): void;
  removeScope(scope: string): void;
  clear(): void;
  list(context: CommandContext): CommandCandidate[];
  search(query: string, context: CommandContext): CommandCandidate[];
  execute<TPayload = unknown>(
    commandId: CommandId,
    payload: TPayload,
    context: CommandContext,
  ): Promise<CommandResult>;
}

export class CommandRegistryServiceImpl implements CommandRegistryService {
  private scopedCommands = new Map<string, CommandDefinition<unknown>[]>();
  private commandMap = new Map<CommandId, CommandDefinition<unknown>>();

  setCommands(scope: string, commands: CommandDefinition[]): void {
    const normalizedScope = scope.trim();
    if (!normalizedScope) {
      throw new Error('scope is required');
    }

    const scoped = new Map(this.scopedCommands);
    const deduped = new Set<string>();
    const nextCommands = commands.map((command) => {
      if (deduped.has(command.id)) {
        throw new Error(`duplicate command id in scope "${normalizedScope}": ${command.id}`);
      }
      deduped.add(command.id);
      return command as CommandDefinition<unknown>;
    });

    scoped.set(normalizedScope, nextCommands);
    const nextMap = this.buildCommandMap(scoped);

    this.scopedCommands = scoped;
    this.commandMap = nextMap;
  }

  removeScope(scope: string): void {
    const normalizedScope = scope.trim();
    if (!normalizedScope) return;

    if (!this.scopedCommands.has(normalizedScope)) return;
    const scoped = new Map(this.scopedCommands);
    scoped.delete(normalizedScope);

    this.scopedCommands = scoped;
    this.commandMap = this.buildCommandMap(scoped);
  }

  clear(): void {
    this.scopedCommands.clear();
    this.commandMap.clear();
  }

  list(context: CommandContext): CommandCandidate[] {
    return this.search('', context);
  }

  search(query: string, context: CommandContext): CommandCandidate[] {
    const candidates: CommandCandidate[] = [];

    for (const definition of this.commandMap.values()) {
      const candidate = toCandidate(definition, context, query);
      if (!candidate) continue;
      candidates.push(candidate);
    }

    return candidates.sort(sortCandidates);
  }

  async execute<TPayload = unknown>(
    commandId: CommandId,
    payload: TPayload,
    context: CommandContext,
  ): Promise<CommandResult> {
    const definition = this.commandMap.get(commandId);
    if (!definition) {
      return {
        ok: false,
        errorCode: 'not-found',
        message: `命令不存在：${commandId}`,
      };
    }

    const availability = resolveAvailability(definition.isAvailable?.(context));
    if (!availability.available) {
      return {
        ok: false,
        errorCode: 'unavailable',
        message: availability.reason || `命令当前不可用：${commandId}`,
      };
    }

    try {
      const result = await definition.execute(payload as unknown, context);
      if (result && typeof result === 'object' && 'ok' in result) {
        return result;
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        errorCode: 'execution-failed',
        message: `命令执行失败：${commandId}`,
        cause: error,
      };
    }
  }

  private buildCommandMap(
    scopedCommands: Map<string, CommandDefinition<unknown>[]>,
  ): Map<CommandId, CommandDefinition<unknown>> {
    const nextMap = new Map<CommandId, CommandDefinition<unknown>>();

    for (const commands of scopedCommands.values()) {
      for (const command of commands) {
        if (nextMap.has(command.id)) {
          throw new Error(`duplicate command id detected: ${command.id}`);
        }
        nextMap.set(command.id, command);
      }
    }

    return nextMap;
  }
}

let commandRegistryServiceInstance: CommandRegistryService | null = null;

export function getCommandRegistryService(): CommandRegistryService {
  if (!commandRegistryServiceInstance) {
    commandRegistryServiceInstance = new CommandRegistryServiceImpl();
  }
  return commandRegistryServiceInstance;
}
