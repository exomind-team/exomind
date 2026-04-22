import { log } from '@/lib/logger';

export function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function sanitizeTraceScope(scope: string): string {
  return scope.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'perf';
}

export function createPerfTraceId(scope: string): string {
  const randomToken = Math.random().toString(36).slice(2, 8);
  return `${sanitizeTraceScope(scope)}-${Date.now().toString(36)}-${randomToken}`;
}

type PerfFields = Record<string, unknown>;

function formatPerfPrefix(scope: string, totalMs: number): string {
  return `[PERF] (${totalMs}ms) ${scope}`;
}

export class PerfTrace {
  readonly traceId: string;

  private readonly startedAt = perfNow();
  private lastStepAt = this.startedAt;
  private readonly steps: PerfFields[] = [];

  constructor(
    private readonly scope: string,
    private readonly baseFields: PerfFields = {},
  ) {
    const candidateTraceId = this.baseFields.traceId;
    this.traceId = typeof candidateTraceId === 'string' && candidateTraceId.trim().length > 0
      ? candidateTraceId.trim()
      : createPerfTraceId(scope);
  }

  step(name: string, fields: PerfFields = {}): void {
    const now = perfNow();
    this.steps.push({
      name,
      stepMs: Math.round(now - this.lastStepAt),
      totalMs: Math.round(now - this.startedAt),
      ...fields,
    });
    this.lastStepAt = now;
  }

  totalMs(): number {
    return Math.round(perfNow() - this.startedAt);
  }

  finish(fields: PerfFields = {}): void {
    const totalMs = this.totalMs();
    log.info(`${formatPerfPrefix(this.scope, totalMs)} ${JSON.stringify(this.buildPayload(fields, totalMs))}`);
  }

  fail(error: unknown, fields: PerfFields = {}): void {
    const totalMs = this.totalMs();
    log.error(
      `${formatPerfPrefix(this.scope, totalMs)} failed ${JSON.stringify({
        ...this.buildPayload(fields, totalMs),
        error: error instanceof Error ? error.message : String(error),
      })}`,
    );
  }

  private buildPayload(fields: PerfFields, totalMs: number): PerfFields {
    return {
      ...this.baseFields,
      ...fields,
      traceId: this.traceId,
      totalMs,
      steps: this.steps,
    };
  }
}

export async function waitForNextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return;
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
