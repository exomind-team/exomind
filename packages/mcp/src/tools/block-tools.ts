/**
 * TimeBlock MCP Tools - With real Service integration
 *
 * Provides tools for managing ExoMind TimeBlocks
 */

import PouchDB from 'pouchdb-node';

// Types
interface StartBlockInput {
  name: string;
  mode?: 'countup' | 'countdown';
  minutes?: number;
}

interface EndBlockInput {
  feedback?: string;
}

interface GetBlocksInput {
  date?: string;
}

interface ActiveBlockDoc {
  _id: string;
  _rev?: string;
  startId: string;
  name: string;
  startTime: number;
  elapsed: number;
  mode: string;
  targetMinutes?: number;
  updatedAt: number;
  paused: boolean;
}

interface TimeBlockDoc {
  _id: string;
  _rev?: string;
  id: string;
  name: string;
  startId: string;
  endId: string;
  note?: string;
  tags: string[];
  startTime: number;
  endTime: number;
}

// Database instances
let activeDb: PouchDB.Database | null = null;
let blocksDb: PouchDB.Database | null = null;

function getActiveDb(): PouchDB.Database {
  if (!activeDb) {
    activeDb = new PouchDB('exomind-active-block');
  }
  return activeDb;
}

function getBlocksDb(): PouchDB.Database {
  if (!blocksDb) {
    blocksDb = new PouchDB('exomind-time-blocks');
  }
  return blocksDb;
}

export function createBlockTools() {
  return [
    {
      name: 'exomind_start_block',
      description: 'Start a new time block in ExoMind',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name/label for the time block',
          },
          mode: {
            type: 'string',
            enum: ['countup', 'countdown'],
            description: 'Timer mode: countup (stopwatch) or countdown (Pomodoro)',
            default: 'countup',
          },
          minutes: {
            type: 'number',
            description: 'Duration in minutes (only for countdown mode)',
          },
        },
        required: ['name'],
      },
      handler: async (args: unknown) => {
        const input = args as StartBlockInput;
        const blockId = crypto.randomUUID();
        const startTime = Date.now();
        const mode = input.mode || 'countup';

        const initialElapsed = mode === 'countdown' ? (input.minutes ?? 25) * 60 * 1000 : 0;

        const activeDoc: ActiveBlockDoc = {
          _id: 'active:block',
          startId: blockId,
          name: input.name,
          startTime,
          elapsed: initialElapsed,
          mode,
          targetMinutes: mode === 'countdown' ? (input.minutes ?? 25) : undefined,
          updatedAt: startTime,
          paused: false,
        };

        const database = getActiveDb();
        try {
          await database.put(activeDoc);
        } catch {
          // If doc exists, get revision and update
          const existing = await database.get('active:block');
          await database.put({ ...activeDoc, _rev: existing._rev });
        }

        return {
          success: true,
          blockId,
          name: input.name,
          startTime,
          mode,
        };
      },
    },
    {
      name: 'exomind_end_block',
      description: 'End the current time block in ExoMind',
      inputSchema: {
        type: 'object',
        properties: {
          feedback: {
            type: 'string',
            description: 'Optional feedback or note about the completed block',
          },
        },
      },
      handler: async (args: unknown) => {
        const input = args as EndBlockInput;
        const endTime = Date.now();

        const activeDatabase = getActiveDb();
        const blocksDatabase = getBlocksDb();

        try {
          const activeDoc = await activeDatabase.get('active:block') as ActiveBlockDoc;

          // Create completed block
          const endId = crypto.randomUUID();
          const completedBlock: TimeBlockDoc = {
            _id: `block:${endId}`,
            id: activeDoc.startId,
            name: activeDoc.name,
            startId: activeDoc.startId,
            endId,
            note: input.feedback,
            tags: input.feedback ? ['block_feedback'] : [],
            startTime: activeDoc.startTime,
            endTime,
          };

          await blocksDatabase.put(completedBlock);

          // Delete active block
          await activeDatabase.remove(activeDoc);

          return {
            success: true,
            endTime,
            feedback: input.feedback,
          };
        } catch {
          // No active block to end
          return {
            success: false,
            endTime,
            feedback: input.feedback,
            error: 'No active block to end',
          };
        }
      },
    },
    {
      name: 'exomind_get_blocks',
      description: 'Get time blocks from ExoMind',
      inputSchema: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Filter blocks by date (ISO date string, e.g., "2026-02-13")',
          },
        },
      },
      handler: async (args: unknown) => {
        const input = args as GetBlocksInput;

        const database = getBlocksDb();

        const result = await database.allDocs({
          include_docs: true,
          startkey: 'block:',
          endkey: 'block:\ufff0',
        });

        let blocks = result.rows
          .map((row) => row.doc as TimeBlockDoc)
          .filter((doc) => doc && doc._id.startsWith('block:'))
          .sort((a, b) => b.endTime - a.endTime);

        // Filter by date if specified
        if (input.date) {
          const targetDate = new Date(input.date);
          const targetDateStr = targetDate.toISOString().split('T')[0];
          blocks = blocks.filter((doc) => {
            const docDate = new Date(doc.endTime).toISOString().split('T')[0];
            return docDate === targetDateStr;
          });
        }

        return {
          success: true,
          count: blocks.length,
          blocks: blocks.map((doc) => ({
            id: doc.id,
            name: doc.name,
            startTime: doc.startTime,
            endTime: doc.endTime,
            duration: doc.endTime - doc.startTime,
            note: doc.note,
          })),
        };
      },
    },
  ];
}
