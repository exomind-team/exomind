import { ExoMindEnvironment } from '@/lib/environment/environment';
import type { IMePort } from '@/lib/environment/interfaces/me.port';
import type { MeDashboardData } from '@/lib/types/me';

type MeEnvironmentLike = {
  me: IMePort;
};

export interface MeService {
  getDashboardData(): Promise<MeDashboardData>;
}

export class MeServiceImpl implements MeService {
  private readonly env: MeEnvironmentLike;

  constructor(env?: MeEnvironmentLike) {
    this.env = env ?? ExoMindEnvironment.getInstance();
  }

  async getDashboardData(): Promise<MeDashboardData> {
    return this.env.me.getDashboardData();
  }
}

let meServiceInstance: MeService | null = null;

export function getMeService(): MeService {
  if (!meServiceInstance) {
    meServiceInstance = new MeServiceImpl();
  }
  return meServiceInstance;
}

