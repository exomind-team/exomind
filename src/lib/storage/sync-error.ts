interface SyncErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  reason?: unknown;
}

export interface SyncErrorDetails {
  isConnectionFailure: boolean;
  name: string;
  message: string;
  status: number | null;
  code: string | null;
}

function toSyncErrorLike(error: unknown): SyncErrorLike {
  if (!error || typeof error !== 'object') {
    return {};
  }
  return error as SyncErrorLike;
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function parseCode(rawCode: unknown, message: string): string | null {
  const code = toStringValue(rawCode).trim();
  if (code.length > 0) {
    return code;
  }

  if (message.includes('ECONNREFUSED')) {
    return 'ECONNREFUSED';
  }
  if (message.includes('ENOTFOUND')) {
    return 'ENOTFOUND';
  }
  if (message.includes('Failed to fetch')) {
    return 'FAILED_TO_FETCH';
  }
  if (message.includes('NetworkError')) {
    return 'NETWORK_ERROR';
  }
  return null;
}

export function getSyncErrorDetails(error: unknown): SyncErrorDetails {
  const syncError = toSyncErrorLike(error);
  const message = toStringValue(syncError.message || syncError.reason || error);
  const name = toStringValue(syncError.name).trim() || 'UnknownError';
  const status = toNumberValue(syncError.status);
  const code = parseCode(syncError.code, message);

  const connectionPatterns = ['ECONNREFUSED', 'ENOTFOUND', 'Failed to fetch', 'NetworkError', 'fetch failed'];
  const hasConnectionPattern = connectionPatterns.some((pattern) => message.includes(pattern));

  const isConnectionFailure = status === 0 ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'FAILED_TO_FETCH' ||
    code === 'NETWORK_ERROR' ||
    hasConnectionPattern;

  return {
    isConnectionFailure,
    name,
    message,
    status,
    code,
  };
}

export function buildSyncErrorLog(context: string, remoteUrl: string, error: unknown): [string, Record<string, unknown>] {
  const details = getSyncErrorDetails(error);

  if (details.isConnectionFailure) {
    return [
      `[${context}] 远程同步连接失败（可能同步服务未启动或不可达）`,
      {
        remoteUrl,
        name: details.name,
        message: details.message,
        status: details.status,
        code: details.code,
        suggestion: '请确认同步服务进程已启动，且 URL/端口可访问',
        rawError: error,
      },
    ];
  }

  return [
    `[${context}] 远程同步错误`,
    {
      remoteUrl,
      name: details.name,
      message: details.message,
      status: details.status,
      code: details.code,
      rawError: error,
    },
  ];
}
