import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCoreNavigationCommands } from '@/lib/services/command-palette.commands';
import type { CommandContext } from '@/lib/types/command-palette';

describe('intent program routing（意图程序入口）', () => {
  const routesSource = readFileSync(path.resolve('src/routes.tsx'), 'utf-8');

  it('registers an app route and navigation item（注册路由与导航入口）', () => {
    expect(routesSource).toContain("path: '/intent-programs'");
    expect(routesSource).toContain("title: '意图'");
    expect(routesSource).toContain('IntentProgramsPage');
  });

  it('adds command palette navigation（命令面板可打开意图程序）', async () => {
    const navigated: string[] = [];
    const commands = createCoreNavigationCommands({
      navigate: (path) => {
        navigated.push(path);
      },
    });
    const command = commands.find((item) => item.id === 'navigate:intent-programs');
    const context: CommandContext = {
      currentPath: '/eventlog',
      platform: 'web',
      developerModeEnabled: true,
      commandPaletteEnabled: true,
      featureFlags: {
        agentPageEnabled: true,
        goalsV2Enabled: false,
      },
    };

    expect(command?.title).toBe('打开意图程序');
    const result = await command?.execute(undefined, context);

    expect(result).toEqual({ ok: true });
    expect(navigated).toEqual(['/intent-programs']);
  });
});
