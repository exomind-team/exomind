import { describe, expect, it, vi } from 'vitest';
import { MeServiceImpl } from '@/lib/services/me.service';
import { MOCK_ME_DASHBOARD_FIXTURE } from '@/lib/adapters/mock/fixtures/me';

describe('issue-215 me service（Me 服务层）', () => {
  it('delegates dashboard query to me port（委托给 me port）', async () => {
    const getDashboardData = vi.fn().mockResolvedValue(MOCK_ME_DASHBOARD_FIXTURE);
    const service = new MeServiceImpl({
      me: {
        getDashboardData,
      },
    });

    const result = await service.getDashboardData();
    expect(getDashboardData).toHaveBeenCalledTimes(1);
    expect(result.status.summaryTitle).toBe('当前状态');
  });
});

