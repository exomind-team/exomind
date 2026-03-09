import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type ReviewAgentStateValue =
  | 'HAS_TARGET'
  | 'NO_TARGET'
  | 'REVIEW_POSTED'
  | 'NEEDS_HUMAN_TEST'
  | 'APPROVE_READY'
  | 'MERGE_READY'
  | 'FAILED_RETRYABLE';
export type ReviewAgentPhase = 'DISCOVERY' | 'REVIEW' | 'IDLE_WAIT';
export type ReviewAgentNextAction = 'discovery' | 'review' | 'idle-wait';

export interface PersistedState {
  state: ReviewAgentStateValue;
  phase: ReviewAgentPhase;
  lastPhase: ReviewAgentPhase | null;
  nextAction: ReviewAgentNextAction;
  selectedPrNumber: number | null;
  selectedReason: string | null;
  activeReviewCommentId?: string | null;
  activeReviewCommentUrl?: string | null;
  inspectedPrCount: number;
  skippedPrCount: number;
  actionableCount: number;
  failureStreak: number;
  nextSleepSeconds: number;
  updatedAt: string;
  error?: string;
}

export interface QueueState {
  selectedPr?: {
    number: number;
  } | null;
}

export const PR_MONITOR_DIR = path.resolve(process.cwd(), 'temp/pr-monitor');
export const STATE_FILE = path.join(PR_MONITOR_DIR, 'state.json');
export const QUEUE_FILE = path.join(PR_MONITOR_DIR, 'queue.json');
export const BACKOFF_FILE = path.join(PR_MONITOR_DIR, 'backoff.json');
export const CURSOR_FILE = path.join(PR_MONITOR_DIR, 'cursor.json');

export function ensurePrMonitorDir(): void {
  mkdirSync(PR_MONITOR_DIR, { recursive: true });
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
