import { createServer } from 'node:net';

type PortValue = number | string | null | undefined;

export interface ResolveEmbeddedRuntimePortOptions {
  candidatePorts?: PortValue[];
  reservedPorts?: PortValue[];
  isPortAvailable?: (port: number) => Promise<boolean>;
  findRandomPort?: () => Promise<number>;
  maxRandomAttempts?: number;
}

function parsePort(value: PortValue): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : null;
  }
  return null;
}

export function normalizeReservedPorts(values: PortValue[]): number[] {
  const deduped = new Set<number>();
  for (const value of values) {
    const port = parsePort(value);
    if (port !== null) {
      deduped.add(port);
    }
  }
  return [...deduped];
}

async function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => {
      resolve(false);
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findRandomFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function resolveEmbeddedRuntimePort(
  options: ResolveEmbeddedRuntimePortOptions = {},
): Promise<number> {
  const reservedPorts = new Set(normalizeReservedPorts(options.reservedPorts ?? []));
  const candidatePorts = normalizeReservedPorts(options.candidatePorts ?? [9124, 1950, 1949])
    .filter((port) => !reservedPorts.has(port));
  const isPortAvailable = options.isPortAvailable ?? checkPortAvailable;

  for (const candidate of candidatePorts) {
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
  }

  const findRandomPort = options.findRandomPort ?? findRandomFreePort;
  const maxRandomAttempts = options.maxRandomAttempts ?? 32;
  for (let attempt = 0; attempt < maxRandomAttempts; attempt += 1) {
    const randomPort = await findRandomPort();
    if (!reservedPorts.has(randomPort)) {
      return randomPort;
    }
  }

  throw new Error('failed to resolve non-reserved embedded runtime port（无法分配未保留的内嵌 Runtime 端口）');
}

function parseCsvArg(raw: string | undefined): PortValue[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

if (import.meta.main) {
  const resolved = await resolveEmbeddedRuntimePort({
    candidatePorts: parseCsvArg(process.argv[2]),
    reservedPorts: parseCsvArg(process.argv[3]),
  });
  process.stdout.write(String(resolved));
}
