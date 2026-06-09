#!/usr/bin/env bun

type TaskStatus = 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'medium' | 'high';
type TaskDependencyType = 'soft' | 'hard';

type SeedTask = {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  dependsOn?: Array<{ taskId: string; type: TaskDependencyType }>;
  estimatedMinutes?: number | null;
};

type RuntimeTask = {
  id: string;
  title: string;
  description: string | null;
  done_condition: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  source: string | null;
  parent_id: string | null;
  depends_on: Array<{ task_id: string; type: TaskDependencyType }>;
  due_at: number | null;
  estimated_minutes: number | null;
  time_block_ids: string[];
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type UpsertResponse = {
  status: 'inserted' | 'updated' | 'ignored';
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 9124;
const DEFAULT_USER_ID = 'anonymous';
const SOURCE_HOST_ID = 'codex-seed-task-dag-search-focus';
const SOURCE_LABEL = 'scripts/dev/seed-task-dag-search-focus-examples.ts';
const SAMPLE_TAG = 'sample';

const SEED_TASKS: SeedTask[] = [
  {
    id: 'sample-dag-search-root',
    title: '样例/DAG 搜索主线：Batch Q DAG 基线',
    status: 'pending',
    priority: 'high',
    tags: [SAMPLE_TAG, 'batch-q', 'dag', 'search'],
    estimatedMinutes: 35,
  },
  {
    id: 'sample-dag-search-verify',
    title: '样例/DAG 搜索主线：Batch Q DAG 联合搜索验收',
    status: 'pending',
    priority: 'high',
    tags: [SAMPLE_TAG, 'batch-q', 'dag', 'search', '验收'],
    dependsOn: [{ taskId: 'sample-dag-search-root', type: 'hard' }],
    estimatedMinutes: 25,
  },
  {
    id: 'sample-dag-search-tag-finish',
    title: '样例/DAG 搜索主线：Batch Q 标签收尾',
    status: 'completed',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'batch-q', 'tag', 'search'],
    dependsOn: [{ taskId: 'sample-dag-search-verify', type: 'hard' }],
    estimatedMinutes: 15,
  },
  {
    id: 'sample-dag-search-focus-main',
    title: '样例/DAG 搜索主线：Batch Q 聚焦系列主链',
    status: 'in_progress',
    priority: 'high',
    tags: [SAMPLE_TAG, 'batch-q', 'dag', 'focus'],
    dependsOn: [{ taskId: 'sample-dag-search-verify', type: 'soft' }],
    estimatedMinutes: 40,
  },
  {
    id: 'sample-dag-search-focus-x',
    title: '样例/DAG 旁系：Batch Q 聚焦系列 X',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'batch-q', 'dag', 'focus'],
  },
  {
    id: 'sample-dag-search-focus-y',
    title: '样例/DAG 旁系：Batch Q 聚焦系列 Y',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'batch-q', 'dag', 'focus'],
    dependsOn: [{ taskId: 'sample-dag-search-focus-x', type: 'hard' }],
  },
  {
    id: 'sample-dag-search-text-only',
    title: '样例/Batch Q 文本命中但标签不命中',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'batch-q', 'docs'],
  },
  {
    id: 'sample-dag-search-tag-only',
    title: '样例/后端 DAG 标签命中但文本不命中',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'dag', 'backend'],
  },
  {
    id: 'sample-dag-search-desc-frontend',
    title: '样例/前端节点',
    description: '补 Markdown 验证',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'frontend'],
  },
  {
    id: 'sample-dag-search-desc-backend',
    title: '样例/后端节点',
    description: '补 Markdown 验证',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'backend'],
  },
  {
    id: 'sample-dag-search-desc-title-only',
    title: '样例/前端 DAG',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'frontend'],
  },
  {
    id: 'sample-dag-search-rt-web',
    title: '样例/RT 联通回归',
    status: 'pending',
    priority: 'medium',
    tags: [SAMPLE_TAG, 'rt', 'web', '验收'],
  },
];

function getArgValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const exact = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === name) {
      return args[index + 1];
    }
    if (current.startsWith(exact)) {
      return current.slice(exact.length);
    }
  }
  return undefined;
}

function resolveBaseUrl(): string {
  const baseUrl = getArgValue('--base-url');
  if (baseUrl) {
    return baseUrl.replace(/\/$/, '');
  }

  const host = getArgValue('--host') ?? DEFAULT_HOST;
  const port = Number(getArgValue('--port') ?? DEFAULT_PORT);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`invalid --port: ${getArgValue('--port')}`);
  }
  return `http://${host}:${port}`;
}

function resolveUserId(): string {
  return getArgValue('--user-id') ?? DEFAULT_USER_ID;
}

function toRuntimeTask(seed: SeedTask, index: number, baseTimestamp: number): RuntimeTask {
  const createdAt = baseTimestamp + index * 10;
  const completedAt = seed.status === 'completed' ? createdAt + 5 : null;
  const updatedAt = completedAt ?? createdAt + 5;
  return {
    id: seed.id,
    title: seed.title,
    description: seed.description ?? null,
    done_condition: null,
    status: seed.status,
    priority: seed.priority,
    tags: seed.tags,
    source: SOURCE_LABEL,
    parent_id: null,
    depends_on: (seed.dependsOn ?? []).map((dependency) => ({
      task_id: dependency.taskId,
      type: dependency.type,
    })),
    due_at: null,
    estimated_minutes: seed.estimatedMinutes ?? null,
    time_block_ids: [],
    created_at: createdAt,
    updated_at: updatedAt,
    completed_at: completedAt,
  };
}

async function upsertTask(baseUrl: string, userId: string, task: RuntimeTask): Promise<UpsertResponse['status']> {
  const url = new URL('/tasks/replication/upsert', baseUrl);
  url.searchParams.set('user_id', userId);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      task,
      source_host_id: SOURCE_HOST_ID,
    }),
  });

  if (!response.ok) {
    throw new Error(`RT upsert failed for ${task.id}: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as UpsertResponse;
  return payload.status;
}

async function listSampleTasks(baseUrl: string, userId: string): Promise<RuntimeTask[]> {
  const url = new URL('/tasks', baseUrl);
  url.searchParams.set('user_id', userId);
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`RT list failed: ${response.status} ${await response.text()}`);
  }
  const tasks = await response.json() as RuntimeTask[];
  return tasks.filter((task) => task.tags.includes(SAMPLE_TAG));
}

function printUsage(): void {
  console.log([
    '用法:',
    '  bun scripts/dev/seed-task-dag-search-focus-examples.ts [--base-url http://127.0.0.1:9124] [--user-id anonymous]',
    '  bun scripts/dev/seed-task-dag-search-focus-examples.ts --host 127.0.0.1 --port 9124 --user-id anonymous',
  ].join('\n'));
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  const baseUrl = resolveBaseUrl();
  const userId = resolveUserId();
  const baseTimestamp = Date.now();

  console.log(`Seeding Task DAG examples to ${baseUrl} (user_id=${userId})`);
  const results = [];
  for (const [index, seed] of SEED_TASKS.entries()) {
    const runtimeTask = toRuntimeTask(seed, index, baseTimestamp);
    const status = await upsertTask(baseUrl, userId, runtimeTask);
    results.push({ id: seed.id, title: seed.title, status });
  }

  const sampleTasks = await listSampleTasks(baseUrl, userId);
  console.log('\nUpsert results:');
  for (const result of results) {
    console.log(`- ${result.status.padEnd(8)} ${result.id}  ${result.title}`);
  }

  console.log(`\nSample tasks now present: ${sampleTasks.length}`);
  console.log(`Manual checks:`);
  console.log(`1. 文本 "Batch Q" + 标签 "dag" + 过滤关闭：主线与旁系同时高亮，其他样例弱化`);
  console.log(`2. 在上一步基础上右键“样例/DAG 搜索主线：Batch Q 聚焦系列主链” => 聚焦此系列：旁系 X/Y 弱化`);
  console.log(`3. 文本 "Markdown" + 开启 "描述" + 标签 "frontend" + 过滤开启：仅保留“样例/前端节点”`);
  console.log(`4. 选择标签 "dag"+"focus"：tag and/or 可切换，观察主线/旁系命中范围变化`);
  console.log(`\nIf the DAG page is already open, refresh it once so the externally seeded tasks are reloaded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
