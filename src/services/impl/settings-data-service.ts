import { invoke, isTauri } from '@tauri-apps/api/core';
import { getEventLogService, getTaskBackupService } from '@/lib/services';

export type ImportStrategy = 'merge' | 'overwrite';

type PickedJsonFile = {
  path: string;
  content: string;
};

function downloadFileFallback(content: BlobPart, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildBackupFileName(): string {
  return `exomind-data-${new Date().toISOString().slice(0, 10)}.json`;
}

export function pickFileOnWeb(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.className = 'hidden';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

export async function exportBackup(): Promise<string> {
  const service = getEventLogService();
  const eventJson = await service.exportEventsAsJson();
  const payload = JSON.parse(eventJson) as {
    version?: number;
    events?: unknown[];
    tasks?: unknown[];
  };
  const eventCount = Array.isArray(payload.events) ? payload.events.length : 0;
  let taskCount = 0;

  try {
    const taskResult = await getTaskBackupService().exportTasksAsJson();
    const taskPayload = JSON.parse(taskResult.content) as { tasks?: unknown[] };
    if (Array.isArray(taskPayload.tasks)) {
      payload.tasks = taskPayload.tasks;
      payload.version = 2;
      taskCount = taskPayload.tasks.length;
    }
  } catch {
    // Keep event-only export when task backup is unavailable.
  }

  const combinedJson = JSON.stringify(payload, null, 2);
  const defaultName = buildBackupFileName();
  const summaryParts: string[] = [];
  if (eventCount > 0) summaryParts.push(`${eventCount} 条事件`);
  if (taskCount > 0) summaryParts.push(`${taskCount} 条任务`);
  const summary = summaryParts.length > 0 ? summaryParts.join('、') : '0 条记录';

  if (await isTauri()) {
    const savedPath = await invoke<string | null>('save_json_file', {
      content: combinedJson,
      defaultName,
    });
    if (!savedPath) return '已取消保存。';
    return `导出成功，共 ${summary}。保存路径：${savedPath}`;
  }

  downloadFileFallback(combinedJson, 'application/json;charset=utf-8', defaultName);
  return `导出成功，共 ${summary}。`;
}

export async function importBackup(strategy: ImportStrategy = 'merge'): Promise<string> {
  let picked: PickedJsonFile | null = null;

  if (await isTauri()) {
    picked = await invoke<PickedJsonFile | null>('pick_json_file');
  } else {
    const file = await pickFileOnWeb('.json');
    if (!file) return '已取消导入。';
    picked = {
      path: file.name,
      content: await file.text(),
    };
  }

  if (!picked) return '已取消导入。';

  const result = await getEventLogService().importEventsFromJson(picked.content, strategy);
  let taskSummary = '';

  try {
    const parsed = JSON.parse(picked.content) as { tasks?: unknown[] };
    if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
      const taskJson = JSON.stringify({ version: 1, tasks: parsed.tasks });
      const taskResult = await getTaskBackupService().importTasksFromJson(taskJson, strategy);
      taskSummary = `；任务新增 ${taskResult.imported} 条，跳过 ${taskResult.skipped} 条`;
    }
  } catch {
    taskSummary = '；任务恢复失败';
  }

  return `导入成功：事件新增 ${result.imported} 条，跳过 ${result.skipped} 条，当前共 ${result.total} 条${taskSummary}。来源：${picked.path}`;
}

export async function exportTasksJson(): Promise<string> {
  const result = await getTaskBackupService().exportTasksAsJson();

  if (await isTauri()) {
    const savedPath = await invoke<string | null>('save_json_file', {
      content: result.content,
      defaultName: result.fileName,
    });
    if (!savedPath) return '已取消保存。';
    return `任务导出成功（JSON），共 ${result.taskCount} 条任务。保存路径：${savedPath}`;
  }

  downloadFileFallback(result.content, 'application/json;charset=utf-8', result.fileName);
  return `任务导出成功（JSON），共 ${result.taskCount} 条任务。`;
}

export async function exportTasksSqlite(): Promise<string> {
  const result = await getTaskBackupService().exportTasksAsSqliteSnapshot();

  if (await isTauri()) {
    const savedPath = await invoke<string | null>('save_binary_file', {
      content: Array.from(result.bytes),
      defaultName: result.fileName,
      filters: ['sqlite', 'db'],
    });
    if (!savedPath) return '已取消保存。';
    return `任务导出成功（SQLite），共 ${result.taskCount} 条任务。保存路径：${savedPath}`;
  }

  downloadFileFallback(result.bytes, 'application/octet-stream', result.fileName);
  return `任务导出成功（SQLite），共 ${result.taskCount} 条任务。`;
}

export async function importTasksFromFile(
  file: File,
  strategy: ImportStrategy = 'merge',
): Promise<string> {
  const lowerName = file.name.toLowerCase();
  const backupService = getTaskBackupService();

  if (lowerName.endsWith('.json')) {
    const content = await file.text();
    const result = await backupService.importTasksFromJson(content, strategy);
    return `任务导入成功：新增 ${result.imported} 条，跳过 ${result.skipped} 条，当前共 ${result.total} 条。来源：${file.name}`;
  }

  if (lowerName.endsWith('.sqlite') || lowerName.endsWith('.db')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await backupService.importTasksFromSqliteSnapshot(bytes, strategy);
    return `任务导入成功：新增 ${result.imported} 条，跳过 ${result.skipped} 条，当前共 ${result.total} 条。来源：${file.name}`;
  }

  throw new Error('仅支持 .json / .sqlite / .db 任务备份文件');
}
