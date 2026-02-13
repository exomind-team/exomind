import type { EventLogService } from '../../../../src/lib/services/eventlog.service';
import { getEventLogService } from '../../../../src/lib/services/eventlog.service';
import type { TimeBlockService } from '../../../../src/lib/services/timeblock.service';
import { TimeBlockServiceImpl } from '../../../../src/lib/services/timeblock.service';
import type { ExoMindEnvironment } from '../../../../src/lib/environment/environment';
import { createMcpEnvironment } from './mcp-environment';

export interface McpToolDependencies {
  eventLogService: EventLogService;
  timeBlockService: TimeBlockService;
}

let dependencies: McpToolDependencies | null = null;

export function createMcpToolDependencies(): McpToolDependencies {
  if (dependencies) return dependencies;

  dependencies = {
    eventLogService: getEventLogService(),
    timeBlockService: new TimeBlockServiceImpl(createMcpEnvironment() as unknown as ExoMindEnvironment),
  };

  return dependencies;
}

