import { describe, expect, it } from 'vitest';
import {
  resolveRuntimeHostBaseUrl,
  resolveRuntimeHostDialAddress,
} from '@/lib/utils/runtime-host-address';

describe('runtime host address utils（Runtime 主机地址工具）', () => {
  it('normalizes localhost dial addresses to 127.0.0.1（localhost 拨号地址应归一到 127.0.0.1）', () => {
    expect(resolveRuntimeHostDialAddress({
      host: 'localhost',
      port: 9124,
      lastSuccessfulDialAddress: 'localhost:9124',
    })).toBe('127.0.0.1:9124');
  });

  it('builds base url from the normalized dial address（baseUrl 应基于归一化后的拨号地址）', () => {
    expect(resolveRuntimeHostBaseUrl({
      host: 'localhost',
      port: 9124,
      lastSuccessfulDialAddress: 'localhost:9124',
    })).toBe('http://127.0.0.1:9124');
  });
});
