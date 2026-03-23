import { describe, expect, it } from 'vitest';
import { buildRemoteDbUrl, normalizeBaseUrl } from '@/lib/sync/remote-db-url';

describe('remote db url resolver', () => {
  it('normalizeBaseUrl should strip trailing slash', () => {
    expect(normalizeBaseUrl('http://localhost:6984/')).toBe('http://localhost:6984');
    expect(normalizeBaseUrl('http://localhost:6984////')).toBe('http://localhost:6984');
  });

  it('buildRemoteDbUrl should append encoded username segment', () => {
    const remote = buildRemoteDbUrl('http://localhost:6984/', 'alice@example.com');
    expect(remote).toBe('http://localhost:6984/alice%40example.com');
  });

  it('buildRemoteDbUrl should reject empty username', () => {
    expect(() => buildRemoteDbUrl('http://localhost:6984', '   ')).toThrowError(
      'username is required'
    );
  });
});

