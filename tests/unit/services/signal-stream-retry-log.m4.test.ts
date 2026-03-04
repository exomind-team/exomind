import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('signal-stream m4（连接失败降噪）', () => {
  it('uses warn-level retry log and deduplicates repeated connection errors（警告重试且去重）', () => {
    const source = readFileSync('src/lib/services/signal-stream.service.ts', 'utf-8');
    expect(source).toContain('private lastConnectionErrorLog: string | null = null;');
    expect(source).toContain("console.warn(`[SignalStream] connection retry: ${msg} (target: ${this.baseUrl})`);");
    expect(source).toContain('if (this.lastConnectionErrorLog !== logKey)');
  });
});

