import { describe, expect, it } from 'vitest';
import { CommandRegistryServiceImpl } from '@/lib/services/command-registry.service';
import type { CommandContext, CommandDefinition } from '@/lib/types/command-palette';

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    currentPath: '/eventlog',
    platform: 'web',
    developerModeEnabled: true,
    commandPaletteEnabled: true,
    featureFlags: {
      mePageEnabled: false,
      agentPageEnabled: true,
      goalsV2Enabled: false,
      ...overrides.featureFlags,
    },
    ...overrides,
  };
}

function createCommand(definition: Partial<CommandDefinition> & Pick<CommandDefinition, 'id' | 'title'>): CommandDefinition {
  return {
    category: 'navigation',
    permissionTier: 'safe',
    aliases: [],
    keywords: [],
    async execute() {
      return { ok: true };
    },
    ...definition,
  };
}

describe('command registry service issue-243（命令注册与检索）', () => {
  it('searches by title and alias with available commands first（按标题/别名匹配且可用命令优先）', () => {
    const registry = new CommandRegistryServiceImpl();

    registry.setCommands('core', [
      createCommand({
        id: 'navigate:settings',
        title: '打开设置',
        aliases: ['设置', 'settings'],
      }),
      createCommand({
        id: 'navigate:goals-new',
        title: '打开目标（新）',
        aliases: ['目标', 'goals'],
        isAvailable: () => ({ available: false, reason: '即将支持' }),
      }),
    ]);

    const results = registry.search('设', createContext());
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('navigate:settings');
    expect(results[0].available).toBe(true);

    const goalsResults = registry.search('目标', createContext());
    expect(goalsResults[0].id).toBe('navigate:goals-new');
    expect(goalsResults[0].available).toBe(false);
    expect(goalsResults[0].reason).toBe('即将支持');
  });

  it('returns unavailable when executing a disabled command（执行不可用命令返回 unavailable）', async () => {
    const registry = new CommandRegistryServiceImpl();

    registry.setCommands('core', [
      createCommand({
        id: 'navigate:goals-new',
        title: '打开目标（新）',
        isAvailable: () => ({ available: false, reason: '即将支持' }),
      }),
    ]);

    const result = await registry.execute('navigate:goals-new', undefined, createContext());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe('unavailable');
  });

  it('throws when duplicate command id exists across scopes（跨 scope 重复 id 抛错）', () => {
    const registry = new CommandRegistryServiceImpl();

    registry.setCommands('scope-a', [
      createCommand({ id: 'navigate:settings', title: '打开设置' }),
    ]);

    expect(() => {
      registry.setCommands('scope-b', [
        createCommand({ id: 'navigate:settings', title: '设置（重复）' }),
      ]);
    }).toThrow(/duplicate command id/i);
  });
});
