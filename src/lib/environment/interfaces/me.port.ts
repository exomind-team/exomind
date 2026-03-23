import type { MeDashboardData } from '@/lib/types/me';

export interface IMePort {
  getDashboardData(): Promise<MeDashboardData>;
}

