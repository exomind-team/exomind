import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('SettingsPage export runtime routing', () => {
  const newSettingsSource = readFileSync(path.resolve('src/ui/app/pages/SettingsPage.tsx'), 'utf-8');

  it('uses tauri native commands for export/import', () => {
    expect(newSettingsSource).toContain("invoke<string | null>('save_json_file'");
    expect(newSettingsSource).toContain("invoke<PickedJsonFile | null>('pick_json_file')");
  });

  it('keeps web blob fallback export behavior', () => {
    expect(newSettingsSource).toContain('downloadJsonFallback');
    expect(newSettingsSource).toContain('URL.createObjectURL');
  });
});
