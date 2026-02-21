import { describe, expect, it } from 'vitest';
import { VoiceChatService } from '@/lib/services/voice-chat.service';

describe('VoiceChatService', () => {
  it('uses moss adapter when adapterType is moss', () => {
    const service = Object.create(VoiceChatService.prototype) as any;
    const httpAdapter = { name: 'http' };
    const wsAdapter = { name: 'ws' };
    const mossAdapter = { name: 'moss' };

    service.httpAdapter = httpAdapter;
    service.wsAdapter = wsAdapter;
    service.mossAdapter = mossAdapter;
    service.adapterType = 'moss';

    expect(service.getCurrentAdapter()).toBe(mossAdapter);
  });
});
