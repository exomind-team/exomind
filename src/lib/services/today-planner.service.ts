import { TodayPlannerRtAdapter } from '@/lib/adapters/today-planner-rt-adapter';
import type {
  ActiveBlockData,
  CreatePlannedTimeBlockInput,
  TodayPlannerBlock,
  TodayPlannerSnapshot,
  UpdatePlannedTimeBlockInput,
} from '@/lib/types/event';

export interface TodayPlannerService {
  getTodayPlanner(date: string): Promise<TodayPlannerSnapshot>;
  createPlannedBlock(input: CreatePlannedTimeBlockInput): Promise<TodayPlannerBlock>;
  updatePlannedBlock(blockId: string, input: UpdatePlannedTimeBlockInput): Promise<TodayPlannerBlock>;
  reorderPlannedBlocks(date: string, orderedIds: string[]): Promise<TodayPlannerSnapshot>;
  startPlannedBlock(blockId: string): Promise<ActiveBlockData>;
  deletePlannedBlock(blockId: string): Promise<void>;
}

export class TodayPlannerServiceImpl implements TodayPlannerService {
  constructor(private readonly rtAdapter: TodayPlannerRtAdapter = new TodayPlannerRtAdapter()) {}

  getTodayPlanner(date: string): Promise<TodayPlannerSnapshot> {
    return this.rtAdapter.getTodayPlanner(date);
  }

  createPlannedBlock(input: CreatePlannedTimeBlockInput): Promise<TodayPlannerBlock> {
    return this.rtAdapter.createPlannedBlock(input);
  }

  updatePlannedBlock(blockId: string, input: UpdatePlannedTimeBlockInput): Promise<TodayPlannerBlock> {
    return this.rtAdapter.updatePlannedBlock(blockId, input);
  }

  reorderPlannedBlocks(date: string, orderedIds: string[]): Promise<TodayPlannerSnapshot> {
    return this.rtAdapter.reorderPlannedBlocks(date, orderedIds);
  }

  startPlannedBlock(blockId: string): Promise<ActiveBlockData> {
    return this.rtAdapter.startPlannedBlock(blockId);
  }

  deletePlannedBlock(blockId: string): Promise<void> {
    return this.rtAdapter.deletePlannedBlock(blockId);
  }
}

let todayPlannerServiceInstance: TodayPlannerService | null = null;

export function getTodayPlannerService(): TodayPlannerService {
  if (!todayPlannerServiceInstance) {
    todayPlannerServiceInstance = new TodayPlannerServiceImpl();
  }
  return todayPlannerServiceInstance;
}
