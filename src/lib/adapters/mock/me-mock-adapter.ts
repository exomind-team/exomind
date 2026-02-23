import type { IMePort } from '@/lib/environment/interfaces/me.port';
import type { MeDashboardData } from '@/lib/types/me';
import { MOCK_ME_DASHBOARD_FIXTURE } from './fixtures/me';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MeMockAdapter implements IMePort {
  async getDashboardData(): Promise<MeDashboardData> {
    return deepClone(MOCK_ME_DASHBOARD_FIXTURE);
  }
}

