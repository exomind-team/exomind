import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IStoragePort, QueryOptions, QueryResult } from '../../../../src/lib/environment/interfaces/storage.port';

type StorageMap = Record<string, unknown>;

function currentDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function defaultStoragePath(): string {
  return process.env.EXOMIND_MCP_STORAGE_PATH
    ? path.resolve(process.env.EXOMIND_MCP_STORAGE_PATH)
    : path.resolve(currentDir(), '../../.data/storage.json');
}

async function readJsonFile(filePath: string): Promise<StorageMap> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StorageMap;
    }
    return {};
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeJsonFileAtomic(filePath: string, data: StorageMap): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    // Windows rename() cannot replace existing files; fall back to unlink + rename.
    await fs.unlink(filePath).catch(() => undefined);
    await fs.rename(tmpPath, filePath);
  }
}

export class NodeFileStorageAdapter implements IStoragePort {
  private filePath: string;

  constructor(filePath: string = defaultStoragePath()) {
    this.filePath = filePath;
  }

  async write<T>(key: string, data: T): Promise<void> {
    const current = await readJsonFile(this.filePath);
    current[key] = data;
    await writeJsonFileAtomic(this.filePath, current);
  }

  async read<T>(key: string): Promise<T | null> {
    const current = await readJsonFile(this.filePath);
    return (key in current ? (current[key] as T) : null);
  }

  async delete(key: string): Promise<void> {
    const current = await readJsonFile(this.filePath);
    delete current[key];
    await writeJsonFileAtomic(this.filePath, current);
  }

  async readAll<T>(): Promise<Map<string, T>> {
    const current = await readJsonFile(this.filePath);
    return new Map(Object.entries(current) as Array<[string, T]>);
  }

  async clear(): Promise<void> {
    await writeJsonFileAtomic(this.filePath, {});
  }

  async query<T>(_options: QueryOptions<T>): Promise<QueryResult<T>> {
    return { items: [], total: 0, hasMore: false };
  }
}
