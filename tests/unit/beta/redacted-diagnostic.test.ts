import { describe, expect, it } from 'vitest';
import { redactDiagnostic } from '@/beta/redacted-diagnostic';

const SOURCE = {
  operation: 'peer_sync',
  code: 'E0425',
  deviceId: 'dev-11111111111111111111111111111111',
  profileId: 'profile-22222222222222222222222222222222',
  candidate: 'Beta25',
  lastStage: 'uploading',
  timestampMs: 1732176000000,
  secret: 'fake-secret-value',
  body: 'private profile body',
  content: 'private content bytes',
  profileBody: 'profile body',
  token: 'opaque-token',
  invitationSecret: 'invitation-secret',
  originalBytes: new Uint8Array([1, 2, 3]),
};

describe('redactDiagnostic', () => {
  it('drops secret/body/content and retains the allowlisted, stable-masked fields', () => {
    const redacted = redactDiagnostic(SOURCE);

    expect(redacted).toEqual({
      operation: 'peer_sync',
      code: 'E0425',
      deviceId: 'dev-1111',
      profileId: 'profile-',
      candidate: 'Beta25',
      lastStage: 'uploading',
      timestampMs: 1732176000000,
    });
    expect(redacted).not.toHaveProperty('secret');
    expect(redacted).not.toHaveProperty('body');
    expect(redacted).not.toHaveProperty('content');
    expect(redacted).not.toHaveProperty('profileBody');
    expect(redacted).not.toHaveProperty('token');
    expect(redacted).not.toHaveProperty('invitationSecret');
    expect(redacted).not.toHaveProperty('originalBytes');
  });

  it('returns a safe empty diagnostic for arbitrary exceptions without stringifying them', () => {
    const error = new Error('secret stack trace');
    const redacted = redactDiagnostic(error);

    expect(redacted).toEqual({
      operation: null,
      code: null,
      deviceId: null,
      profileId: null,
      candidate: null,
      lastStage: null,
      timestampMs: null,
    });
    expect(JSON.stringify(redacted)).not.toContain('secret');
  });
});
