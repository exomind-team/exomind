import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('settings data service export runtime routing', () => {
  const source = readFileSync(path.resolve('src/services/impl/settings-data-service.ts'), 'utf-8');

  it('uses tauri native commands for export/import', () => {
    expect(source).toContain("invoke<string | null>('save_json_file'");
    expect(source).toContain("invoke<PickedJsonFile | null>('pick_json_file')");
  });

  it('keeps web blob fallback export behavior', () => {
    expect(source).toContain('downloadFileFallback');
    expect(source).toContain('URL.createObjectURL');
  });
});
