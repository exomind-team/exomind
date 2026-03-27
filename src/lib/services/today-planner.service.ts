import { TodayPlannerRtAdapter } from '@/lib/adapters/today-planner-rt-adapter';
import { getTimeBlockService } from './timeblock.service';
import type {
  ActiveBlockData,
  CreateSchedulingWindowInput,
  ReflowSchedulingWindowInput,
  TodayPlannerSnapshot,
  TodayPlannerSegment,
  TodayPlannerWindow,
  UpdatePlannedSegmentInput,
} from '@/lib/types/event';

export interface TodayPlannerService {
  getTodayPlanner(date: string): Promise<TodayPlannerSnapshot>;
  createSchedulingWindow(input: CreateSchedulingWindowInput): Promise<TodayPlannerWindow>;
  updatePlannedSegment(segmentId: string, input: UpdatePlannedSegmentInput): Promise<TodayPlannerSegment>;
  startWorkSegment(segmentId: string): Promise<ActiveBlockData>;
  reflowSchedulingWindow(windowId: string, input: ReflowSchedulingWindowInput): Promise<TodayPlannerWindow>;
}

export class TodayPlannerServiceImpl implements TodayPlannerService {
  constructor(private readonly rtAdapter: TodayPlannerRtAdapter = new TodayPlannerRtAdapter()) {}

  getTodayPlanner(date: string): Promise<TodayPlannerSnapshot> {
    return this.rtAdapter.getTodayPlanner(date);
  }

  createSchedulingWindow(input: CreateSchedulingWindowInput): Promise<TodayPlannerWindow> {
    return this.rtAdapter.createSchedulingWindow(input);
  }

  updatePlannedSegment(segmentId: string, input: UpdatePlannedSegmentInput): Promise<TodayPlannerSegment> {
    return this.rtAdapter.updatePlannedSegment(segmentId, input);
  }

  async startWorkSegment(segmentId: string): Promise<ActiveBlockData> {
    const activeBlock = await this.rtAdapter.startWorkSegment(segmentId);
    await getTimeBlockService().applyReplicatedActiveBlock(activeBlock);
    return activeBlock;
  }

  reflowSchedulingWindow(windowId: string, input: ReflowSchedulingWindowInput): Promise<TodayPlannerWindow> {
    return this.rtAdapter.reflowSchedulingWindow(windowId, input);
  }
}

let todayPlannerServiceInstance: TodayPlannerService | null = null;

export function getTodayPlannerService(): TodayPlannerService {
  if (!todayPlannerServiceInstance) {
    todayPlannerServiceInstance = new TodayPlannerServiceImpl();
  }
  return todayPlannerServiceInstance;
}
