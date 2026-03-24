import { describe, expect, it, vi } from 'vitest';
import { createCoreNavigationCommands } from '@/lib/services/command-palette.commands';

describe('issue-551 me command palette registration（Me 页面命令注册）', () => {
  it('omits navigate:me when the me page feature flag is disabled（关闭开关时不注册打开 Me）', () => {
    const commands = createCoreNavigationCommands({
      navigate: vi.fn(),
      featureFlags: {
        mePageEnabled: false,
      },
    });

    expect(commands.find((command) => command.id === 'navigate:me')).toBeUndefined();
  });

  it('registers navigate:me when the me page feature flag is enabled（开启开关时注册打开 Me）', async () => {
    const navigate = vi.fn();
    const commands = createCoreNavigationCommands({
      navigate,
      featureFlags: {
        mePageEnabled: true,
      },
    });

    const meCommand = commands.find((command) => command.id === 'navigate:me');
    expect(meCommand).toBeDefined();

    const result = await meCommand?.execute(undefined, {
      currentPath: '/settings',
      platform: 'web',
      developerModeEnabled: true,
      commandPaletteEnabled: true,
      featureFlags: {
        mePageEnabled: true,
        agentPageEnabled: false,
        goalsV2Enabled: false,
      },
    });

    expect(navigate).toHaveBeenCalledWith('/me');
    expect(result).toEqual({ ok: true });
  });
});
