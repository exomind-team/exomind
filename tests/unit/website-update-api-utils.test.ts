import { describe, expect, it } from 'vitest';
import {
  isValidVersionParam,
  normalizePreviewVersionsPayload,
} from '../../website/src/lib/update-api-utils';

describe('isValidVersionParam', () => {
  it('accepts release and preview version tags', () => {
    expect(isValidVersionParam('v0.3.3')).toBe(true);
    expect(isValidVersionParam('v0.3.4-build.20260227T1430')).toBe(true);
  });

  it('rejects malformed or unsafe version tags', () => {
    expect(isValidVersionParam('')).toBe(false);
    expect(isValidVersionParam('../v0.3.3')).toBe(false);
    expect(isValidVersionParam('v0.3')).toBe(false);
    expect(isValidVersionParam('v0.3.3/windows-x64')).toBe(false);
  });
});

describe('normalizePreviewVersionsPayload', () => {
  it('supports legacy array payload with default retention', () => {
    const legacy = [
      {
        version: '0.3.4-build.20260227T1430',
        tag: 'build/v0.3.4-build.20260227T1430',
        published_at: '2026-02-27T14:30:00Z',
      },
    ];
    const result = normalizePreviewVersionsPayload(legacy);

    expect(result.versions).toEqual(legacy);
    expect(result.retention).toBe(15);
  });

  it('prefers object payload retention and filters invalid entries', () => {
    const payload = {
      versions: [
        {
          version: '0.3.4-build.20260227T1430',
          tag: 'build/v0.3.4-build.20260227T1430',
          published_at: '2026-02-27T14:30:00Z',
        },
        { foo: 'bar' },
      ],
      retention: 20,
    };
    const result = normalizePreviewVersionsPayload(payload);

    expect(result.retention).toBe(20);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].version).toBe('0.3.4-build.20260227T1430');
  });

  it('keeps entries even when legacy payload omits tag', () => {
    const payload = {
      versions: [
        {
          version: '0.3.4-build.20260227T1430',
          published_at: '2026-02-27T14:30:00Z',
        },
      ],
    };
    const result = normalizePreviewVersionsPayload(payload);

    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].tag).toBe('');
  });
});
