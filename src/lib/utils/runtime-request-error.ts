type RuntimeFetch = typeof fetch;

export type RuntimeRequestFailureKind = 'network' | 'http';

interface RuntimeRequestErrorOptions {
  kind: RuntimeRequestFailureKind;
  url: string;
  status?: number;
  detail?: string;
}

export class RuntimeRequestError extends Error {
  readonly kind: RuntimeRequestFailureKind;
  readonly url: string;
  readonly status: number | null;
  readonly detail?: string;

  constructor(message: string, options: RuntimeRequestErrorOptions) {
    super(message);
    this.name = 'RuntimeRequestError';
    this.kind = options.kind;
    this.url = options.url;
    this.status = options.status ?? null;
    this.detail = options.detail;
  }
}

const MAX_ERROR_DETAIL_LENGTH = 320;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateDetail(value: string): string {
  if (value.length <= MAX_ERROR_DETAIL_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`;
}

function summarizeJsonErrorBody(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail']) {
    const raw = record[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return truncateDetail(normalizeWhitespace(raw));
    }
  }

  return null;
}

async function readResponseDetail(response: Response): Promise<string | undefined> {
  const body = await response.text().catch(() => '');
  const normalized = normalizeWhitespace(body);
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return summarizeJsonErrorBody(parsed) ?? truncateDetail(normalized);
  } catch {
    return truncateDetail(normalized);
  }
}

export async function fetchRuntimeResponseOrThrow(
  fetchImpl: RuntimeFetch,
  url: string,
  init: RequestInit | undefined,
  context: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RuntimeRequestError(
      `${context} failed [network] url=${url} detail=${detail}`,
      {
        kind: 'network',
        url,
        detail,
      },
    );
  }
}

export async function ensureRuntimeResponseOk(
  response: Response,
  url: string,
  context: string,
): Promise<void> {
  if (response.ok) {
    return;
  }

  const detail = await readResponseDetail(response);
  throw new RuntimeRequestError(
    `${context} failed [http ${response.status}] url=${url}${detail ? ` detail=${detail}` : ''}`,
    {
      kind: 'http',
      url,
      status: response.status,
      detail,
    },
  );
}
