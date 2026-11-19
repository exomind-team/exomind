import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read a fixed byte snapshot; appends after fstat cannot extend this read. */
export function readBoundedLogTail(path: string, maxBytes = 4096) {
  if (!isAbsolute(path) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536) {
    throw new Error('Use an absolute log path and a byte budget between 1 and 65536');
  }
  const descriptor = openSync(path, 'r');
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error('Log snapshot requires a regular file');
    const offset = Math.max(0, metadata.size - maxBytes);
    const buffer = Buffer.alloc(Math.min(metadata.size, maxBytes));
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, offset);
    return { snapshotBytes: metadata.size, offset, bytesRead, truncated: offset > 0 || bytesRead < buffer.length, text: buffer.subarray(0, bytesRead).toString('utf8') };
  } finally { closeSync(descriptor); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path, bytes = '4096', ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error('Usage: bounded-log.ts <absolute-file> [max-bytes]');
  process.stdout.write(`${JSON.stringify(readBoundedLogTail(path, Number(bytes)))}\n`);
}
