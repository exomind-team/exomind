import type { EventLogService } from '../../../../src/lib/services/eventlog.service';
import { EventLogServiceImpl } from '../../../../src/lib/services/eventlog.service';
import type { TimeBlockService } from '../../../../src/lib/services/timeblock.service';
import { TimeBlockServiceImpl } from '../../../../src/lib/services/timeblock.service';
import { createMcpEnvironment, validateUserCredentials } from './mcp-environment';

export interface McpToolDependencies {
  eventLogService: EventLogService;
  timeBlockService: TimeBlockService;
}

let dependencies: McpToolDependencies | null = null;

export function createMcpToolDependencies(): McpToolDependencies {
  if (dependencies) return dependencies;

  const env = createMcpEnvironment();
  dependencies = {
    eventLogService: new EventLogServiceImpl({ port: env.eventlog }),
    timeBlockService: new TimeBlockServiceImpl(env),
  };

  return dependencies;
}

let authResult: { valid: boolean; userId: string | null; passwordHash: string | null } | null = null;

export async function initMcpWithAuth(): Promise<{ valid: boolean; userId: string | null; passwordHash: string | null }> {
  // 启动时验证用户凭据
  const result = await validateUserCredentials();
  authResult = result;

  if (!result.valid && result.reason === 'USER_PASSWD required') {
    throw new Error('USER_PASSWD is required when USER_ID is set');
  }

  return result;
}

export function getAuthResult() {
  return authResult;
}

