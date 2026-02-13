import type { EventLogService } from '../../../../src/lib/services/eventlog.service';
import { EventLogServiceImpl } from '../../../../src/lib/services/eventlog.service';
import type { TimeBlockService } from '../../../../src/lib/services/timeblock.service';
import { TimeBlockServiceImpl } from '../../../../src/lib/services/timeblock.service';
import { createMcpEnvironment } from './mcp-environment';

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

