import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('settings version fallback', () => {
  it('uses package.json version instead of a stale hardcoded about fallback（关于页版本回退不应写死旧版本号）', () => {
    const source = readFileSync(
      path.resolve('src/ui/app/config/settings/settings-registry.ts'),
      'utf8',
    );

    expect(source).toContain("import packageJson from '../../../../../package.json';");
    expect(source).toContain("const SETTINGS_APP_BASE_VERSION = packageJson.version ?? '0.0.0';");
    expect(source).toContain('resolveVersionBuildInfo(envMap, SETTINGS_APP_BASE_VERSION)');
    expect(source).not.toContain("return '0.3.6'");
    expect(source).not.toContain("resolveVersionBuildInfo(envMap, '0.3.6')");
  });
});
