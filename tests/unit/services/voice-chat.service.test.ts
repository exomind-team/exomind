import { describe, expect, it } from 'vitest';
import { VoiceChatService } from '@/lib/services/voice-chat.service';

describe('VoiceChatService', () => {
  it('uses http adapter when adapterType is http', () => {
    const service = Object.create(VoiceChatService.prototype) as any;
    const httpAdapter = { name: 'http' };
    const wsAdapter = { name: 'ws' };

    service.httpAdapter = httpAdapter;
    service.wsAdapter = wsAdapter;
    service.adapterType = 'http';

    expect(service.getCurrentAdapter()).toBe(httpAdapter);
  });

  it('uses websocket adapter when adapterType is websocket', () => {
    const service = Object.create(VoiceChatService.prototype) as any;
    const httpAdapter = { name: 'http' };
    const wsAdapter = { name: 'ws' };

    service.httpAdapter = httpAdapter;
    service.wsAdapter = wsAdapter;
    service.adapterType = 'websocket';

    expect(service.getCurrentAdapter()).toBe(wsAdapter);
  });
});
