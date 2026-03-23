export type CommandId = string;

export type CommandCategory = 'navigation' | 'action' | 'settings' | 'system' | string;

export type CommandPermissionTier = 'safe' | 'confirm' | 'danger';

export type CommandErrorCode = 'not-found' | 'unavailable' | 'execution-failed';

export interface CommandContext {
  currentPath: string;
  platform: 'web' | 'tauri' | 'unknown';
  developerModeEnabled: boolean;
  commandPaletteEnabled: boolean;
  featureFlags: {
    mePageEnabled: boolean;
    agentPageEnabled: boolean;
    goalsV2Enabled: boolean;
    [key: string]: boolean | undefined;
  };
}

export type CommandAvailability =
  | boolean
  | {
      available: boolean;
      reason?: string;
    };

export type CommandResult =
  | {
      ok: true;
      message?: string;
    }
  | {
      ok: false;
      errorCode: CommandErrorCode;
      message: string;
      cause?: unknown;
    };

export interface CommandDefinition<TPayload = unknown> {
  id: CommandId;
  title: string;
  description?: string;
  category: CommandCategory;
  permissionTier: CommandPermissionTier;
  aliases?: string[];
  keywords?: string[];
  isAvailable?: (context: CommandContext) => CommandAvailability;
  execute: (payload: TPayload, context: CommandContext) => Promise<CommandResult> | CommandResult;
}

export interface CommandCandidate {
  id: CommandId;
  title: string;
  description?: string;
  category: CommandCategory;
  permissionTier: CommandPermissionTier;
  aliases: string[];
  keywords: string[];
  available: boolean;
  reason?: string;
  score: number;
}
