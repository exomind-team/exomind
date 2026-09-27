import type { CommandDefinition } from '@/lib/types/command-palette';

export type CoreNavigationPath = '/' | '/eventlog' | '/tasks' | '/reminders' | '/settings' | '/agents';

interface CreateCoreNavigationCommandsOptions {
  navigate: (path: CoreNavigationPath) => Promise<void> | void;
  openReminderComposer?: () => void;
}

export function createCoreNavigationCommands(
  options: CreateCoreNavigationCommandsOptions,
): CommandDefinition[] {
  return [
    {
      id: 'navigate:home',
      title: '打开首页',
      description: '跳转到仪式首页',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['首页', 'home', 'ritual'],
      keywords: ['开机', '收工', '主页'],
      async execute() {
        await options.navigate('/');
        return { ok: true };
      },
    },
    {
      id: 'navigate:now',
      title: '打开当下',
      description: '跳转到当下页面',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['当下', 'now', 'eventlog', 'focus'],
      keywords: ['今日记录', '聊天', 'timeline'],
      async execute() {
        await options.navigate('/eventlog');
        return { ok: true };
      },
    },
    {
      id: 'navigate:focus',
      title: '打开专注',
      description: '跳转到专注/输入主页面',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['专注', 'focus'],
      keywords: ['番茄钟', '输入', '事件日志'],
      async execute() {
        await options.navigate('/eventlog');
        return { ok: true };
      },
    },
    {
      id: 'navigate:tasks',
      title: '打开任务',
      description: '跳转到任务页面',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['任务', 'tasks', 'task'],
      keywords: ['todo', '计划'],
      async execute() {
        await options.navigate('/tasks');
        return { ok: true };
      },
    },
    {
      id: 'navigate:settings',
      title: '打开设置',
      description: '跳转到设置页面',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['设置', 'settings', 'config'],
      keywords: ['偏好', '配置', '开关'],
      async execute() {
        await options.navigate('/settings');
        return { ok: true };
      },
    },
    {
      id: 'navigate:reminders',
      title: '打开提醒',
      description: '跳转到提醒页面',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['提醒', 'reminder', 'reminders'],
      keywords: ['定时提醒', '通知', '日程'],
      async execute() {
        await options.navigate('/reminders');
        return { ok: true };
      },
    },
    {
      id: 'action:create-reminder',
      title: '新建提醒',
      description: '在提醒页打开新建提醒表单',
      category: 'action',
      permissionTier: 'safe',
      aliases: ['创建提醒', '添加提醒', 'new reminder'],
      keywords: ['提醒', '创建', 'deadline'],
      async execute() {
        options.openReminderComposer?.();
        await options.navigate('/reminders');
        return { ok: true };
      },
    },
    {
      id: 'navigate:agents',
      title: '打开网络',
      description: '跳转到网络页面',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['网络', 'network', 'agent', 'agents', '智能体'],
      keywords: ['信号网络', 'hub', '代理'],
      isAvailable(context) {
        if (context.featureFlags.agentPageEnabled) {
          return true;
        }
        return {
          available: false,
          reason: '请先在设置-开发者中启用网络页面',
        };
      },
      async execute() {
        await options.navigate('/agents');
        return { ok: true };
      },
    },
    {
      id: 'navigate:goals-legacy',
      title: '打开目标（长期任务）',
      description: '已移至任务页，跳转到当下视图',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['目标', 'goals', '长期'],
      keywords: ['长期任务', 'strategy'],
      async execute() {
        await options.navigate('/tasks');
        return { ok: true };
      },
    },
    {
      id: 'navigate:goals-new',
      title: '打开目标（新系统）',
      description: 'v0.5 目标系统入口占位',
      category: 'navigation',
      permissionTier: 'safe',
      aliases: ['目标系统', 'goals-v2', 'goal-system'],
      keywords: ['epic', 'goal'],
      isAvailable: () => ({
        available: false,
        reason: '目标系统即将支持（v0.5）',
      }),
      async execute() {
        return {
          ok: false,
          errorCode: 'unavailable',
          message: '目标系统即将支持（v0.5）',
        };
      },
    },
  ];
}
