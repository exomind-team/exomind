import type { IMePort } from '@/lib/environment/interfaces/me.port';
import type { MeDashboardData } from '@/lib/types/me';
import { MOCK_ME_DASHBOARD_FIXTURE } from '@/lib/adapters/mock/fixtures/me';

const ME_DASHBOARD_STORAGE_KEY = 'exomind:meDashboard'; // storage key（本地存储键）

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MeWebAdapter implements IMePort {
  async getDashboardData(): Promise<MeDashboardData> {
    if (typeof window === 'undefined') {
      return deepClone(MOCK_ME_DASHBOARD_FIXTURE);
    }

    const raw = window.localStorage.getItem(ME_DASHBOARD_STORAGE_KEY);
    if (!raw) {
      return deepClone(MOCK_ME_DASHBOARD_FIXTURE);
    }

    try {
      const parsed = JSON.parse(raw) as MeDashboardData;
      return deepClone(parsed);
    } catch {
      return deepClone(MOCK_ME_DASHBOARD_FIXTURE);
    }
  }
}

