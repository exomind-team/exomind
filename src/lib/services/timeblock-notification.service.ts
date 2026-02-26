import { isTauri } from '@tauri-apps/api/core';
import {
  getTimeblockNotificationEnabled,
  subscribeTimeblockNotificationEnabledChanges,
} from '@/config/timeblock-notification-enabled';
import type { ActiveBlockData } from '@/lib/types/event';
import { getTimeBlockService, type TimeBlockService } from './timeblock.service';
import {
  dispatchTimeBlockNotificationAction,
  type TimeBlockNotificationAction,
} from './timeblock-notification-dispatcher';

export const TIMEBLOCK_NOTIFICATION_ID = 249001;
export const TIMEBLOCK_NOTIFICATION_SCOPE = 'timeblock';
export const TIMEBLOCK_NOTIFICATION_ACTION_TYPE = {
  idle: 'timeblock-idle',
  running: 'timeblock-running',
  paused: 'timeblock-paused',
} as const;

type TimeBlockNotificationMode = keyof typeof TIMEBLOCK_NOTIFICATION_ACTION_TYPE;

type PermissionState = 'default' | 'denied' | 'granted' | 'prompt' | 'prompt-with-rationale';

type ActionType = {
  id: string;
  actions: Array<{ id: string; title: string }>;
};

type NotificationOptions = {
  id?: number;
  title?: string;
  body?: string;
  actionTypeId?: string;
  ongoing?: boolean;
  autoCancel?: boolean;
  extra?: Record<string, unknown>;
};

type Unlisten = (() => void) | { unlisten?: () => void; unregister?: () => void };

type NotificationPlugin = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<PermissionState>;
  registerActionTypes: (types: ActionType[]) => Promise<void>;
  sendNotification: (options: NotificationOptions | string) => void;
  onAction: (cb: (payload: unknown) => void) => Promise<Unlisten>;
  removeActive?: (ids: number[]) => Promise<void>;
};

type RuntimeInfo = {
  isTauriRuntime: boolean;
  isAndroid: boolean;
};

export type TimeBlockNotificationModel = {
  mode: TimeBlockNotificationMode;
  title: string;
  body: string;
  actionTypeId: string;
};

export function resolveTimeBlockNotificationModel(block: ActiveBlockData | null): TimeBlockNotificationModel {
  if (!block) {
    return {
      mode: 'idle',
      title: '时间块 · 待开始',
      body: '暂无进行中时间块',
      actionTypeId: TIMEBLOCK_NOTIFICATION_ACTION_TYPE.idle,
    };
  }

  if (block.paused) {
    return {
      mode: 'paused',
      title: '时间块已暂停',
      body: block.name,
      actionTypeId: TIMEBLOCK_NOTIFICATION_ACTION_TYPE.paused,
    };
  }

  return {
    mode: 'running',
    title: '时间块进行中',
    body: block.name,
    actionTypeId: TIMEBLOCK_NOTIFICATION_ACTION_TYPE.running,
  };
}

export function resolveNotificationActionFromPayload(payload: unknown): TimeBlockNotificationAction | null {
  if (!payload || typeof payload !== 'object') return null;

  const data = payload as {
    actionId?: unknown;
    notification?: {
      extra?: Record<string, unknown>;
    };
  };

  const scope = data.notification?.extra?.scope;
  if (scope && scope !== TIMEBLOCK_NOTIFICATION_SCOPE) {
    return null;
  }

  const actionId = typeof data.actionId === 'string' ? data.actionId : '';

  if (actionId === 'tap') return 'open';
  if (actionId === 'start') return 'start';
  if (actionId === 'pause') return 'pause';
  if (actionId === 'resume') return 'resume';
  if (actionId === 'end') return 'end';
  if (actionId === 'open') return 'open';

  return null;
}

function resolveUnlisten(listener: Unlisten): () => void {
  if (typeof listener === 'function') return listener;
  if (typeof listener.unlisten === 'function') return listener.unlisten.bind(listener);
  if (typeof listener.unregister === 'function') return listener.unregister.bind(listener);
  return () => {};
}

async function resolveRuntimeInfo(): Promise<RuntimeInfo> {
  const isTauriRuntime = await isTauri();
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return {
    isTauriRuntime,
    isAndroid: /android/i.test(userAgent),
  };
}

async function loadNotificationPlugin(): Promise<NotificationPlugin> {
  const module = await import('@tauri-apps/plugin-notification');
  return module as unknown as NotificationPlugin;
}

const TIMEBLOCK_NOTIFICATION_ACTION_TYPES: ActionType[] = [
  {
    id: TIMEBLOCK_NOTIFICATION_ACTION_TYPE.idle,
    actions: [
      { id: 'start', title: '开始' },
      { id: 'open', title: '打开 App' },
    ],
  },
  {
    id: TIMEBLOCK_NOTIFICATION_ACTION_TYPE.running,
    actions: [
      { id: 'pause', title: '暂停' },
      { id: 'end', title: '结束' },
      { id: 'open', title: '打开 App' },
    ],
  },
  {
    id: TIMEBLOCK_NOTIFICATION_ACTION_TYPE.paused,
    actions: [
      { id: 'resume', title: '继续' },
      { id: 'end', title: '结束' },
      { id: 'open', title: '打开 App' },
    ],
  },
];

export class TimeBlockNotificationServiceImpl {
  private readonly timeBlockService: TimeBlockService;
  private readonly runtimeInfoProvider: () => Promise<RuntimeInfo>;
  private readonly notificationPluginLoader: () => Promise<NotificationPlugin>;
  private readonly dispatchAction: (action: TimeBlockNotificationAction) => void;
  private isEnabled = false;
  private isStarted = false;
  private unlistenAction: (() => void) | null = null;
  private unlistenBlockChange: (() => void) | null = null;
  private plugin: NotificationPlugin | null = null;

  constructor(options?: {
    timeBlockService?: TimeBlockService;
    runtimeInfoProvider?: () => Promise<RuntimeInfo>;
    notificationPluginLoader?: () => Promise<NotificationPlugin>;
    dispatchAction?: (action: TimeBlockNotificationAction) => void;
  }) {
    this.timeBlockService = options?.timeBlockService ?? getTimeBlockService();
    this.runtimeInfoProvider = options?.runtimeInfoProvider ?? resolveRuntimeInfo;
    this.notificationPluginLoader = options?.notificationPluginLoader ?? loadNotificationPlugin;
    this.dispatchAction = options?.dispatchAction ?? dispatchTimeBlockNotificationAction;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      this.isEnabled = true;
      await this.start();
      return;
    }

    this.isEnabled = false;
    await this.stop();
  }

  async start(): Promise<void> {
    if (!this.isEnabled || this.isStarted) return;

    const runtime = await this.runtimeInfoProvider();
    if (!runtime.isTauriRuntime || !runtime.isAndroid) return;

    const plugin = await this.notificationPluginLoader();
    const permissionGranted = await plugin.isPermissionGranted()
      || (await plugin.requestPermission()) === 'granted';

    if (!permissionGranted) return;

    await plugin.registerActionTypes(TIMEBLOCK_NOTIFICATION_ACTION_TYPES);
    const listener = await plugin.onAction((payload) => {
      const action = resolveNotificationActionFromPayload(payload);
      if (!action) return;
      this.dispatchAction(action);
    });

    this.plugin = plugin;
    this.unlistenAction = resolveUnlisten(listener);
    this.unlistenBlockChange = this.timeBlockService.onBlockChange((block) => {
      void this.pushNotification(block);
    });

    const activeBlock = await this.timeBlockService.loadActiveBlock();
    await this.pushNotification(activeBlock);
    this.isStarted = true;
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;

    this.unlistenAction?.();
    this.unlistenBlockChange?.();
    this.unlistenAction = null;
    this.unlistenBlockChange = null;

    if (this.plugin?.removeActive) {
      await this.plugin.removeActive([TIMEBLOCK_NOTIFICATION_ID]);
    }

    this.plugin = null;
    this.isStarted = false;
  }

  private async pushNotification(block: ActiveBlockData | null): Promise<void> {
    if (!this.plugin) return;
    const model = resolveTimeBlockNotificationModel(block);
    this.plugin.sendNotification({
      id: TIMEBLOCK_NOTIFICATION_ID,
      title: model.title,
      body: model.body,
      actionTypeId: model.actionTypeId,
      ongoing: model.mode !== 'idle',
      autoCancel: false,
      extra: { scope: TIMEBLOCK_NOTIFICATION_SCOPE },
    });
  }
}

let singletonService: TimeBlockNotificationServiceImpl | null = null;

export function getTimeBlockNotificationService(): TimeBlockNotificationServiceImpl {
  if (!singletonService) {
    singletonService = new TimeBlockNotificationServiceImpl();
  }
  return singletonService;
}

export function bindTimeBlockNotificationBridge(): () => void {
  const service = getTimeBlockNotificationService();
  void service.setEnabled(getTimeblockNotificationEnabled());

  const unsubscribe = subscribeTimeblockNotificationEnabledChanges((enabled) => {
    void service.setEnabled(enabled);
  });

  return () => {
    unsubscribe();
    void service.setEnabled(false);
  };
}

