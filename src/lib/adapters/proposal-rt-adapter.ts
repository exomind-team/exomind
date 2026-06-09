import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  toRuntimeBaseUrl,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type {
  CreateProposalInput,
  Proposal,
  ProposalActionType,
  ProposalPublisher,
  ProposalStatus,
  UpdateProposalInput,
} from '@/lib/types/proposal';
import {
  toProposal,
  type RuntimeProposalPayload,
  type RuntimeProposalPublisherPayload,
  type RuntimeProposalReferencePayload,
} from './proposal-rt-payload';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

const PROPOSAL_API_BASE_PATH = '/api/proposals';
const DEFAULT_PROPOSAL_RT_TIMEOUT_MS = 3_500;

export interface ProposalQueryFilter {
  status?: ProposalStatus;
  actionType?: ProposalActionType;
}

export interface ProposalRtAdapterOptions {
  fetchImpl?: RuntimeFetch;
  resolveTarget?: () => RuntimeTarget;
  timeoutMs?: number;
}

export class ProposalRtError extends Error {
  readonly status: number;
  readonly responseBody?: string;

  constructor(message: string, status: number, responseBody?: string) {
    super(message);
    this.name = 'ProposalRtError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

function toRuntimeReference(
  reference: Proposal['references'][number],
): RuntimeProposalReferencePayload {
  return {
    ref_type: reference.refType,
    id: reference.id,
    display_text: reference.displayText,
  };
}

function toRuntimePublisher(
  publisher: ProposalPublisher,
): RuntimeProposalPublisherPayload {
  return {
    publisher_type: publisher.publisherType,
    id: publisher.id,
    name: publisher.name,
  };
}

function toRuntimeCreatePayload(
  input: CreateProposalInput,
): Record<string, unknown> {
  return {
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    action_type: input.actionType,
    action_params: input.actionParams,
    references: (input.references ?? []).map(toRuntimeReference),
    publisher: toRuntimePublisher(input.publisher),
  };
}

function toRuntimeUpdatePayload(
  input: UpdateProposalInput,
): Record<string, unknown> {
  return {
    ...('status' in input ? { status: input.status } : {}),
    ...('actionParams' in input ? { action_params: input.actionParams } : {}),
    ...('snoozeUntil' in input ? { snooze_until: input.snoozeUntil ?? null } : {}),
  };
}

export class ProposalRtAdapter {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;
  private readonly timeoutMs: number;

  constructor(options: ProposalRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROPOSAL_RT_TIMEOUT_MS;
  }

  async listProposals(filter?: ProposalQueryFilter): Promise<Proposal[]> {
    const payload = await this.requestJson<RuntimeProposalPayload[]>(
      this.buildListPath(filter),
    );
    return payload.map(toProposal);
  }

  async getProposal(id: string): Promise<Proposal | null> {
    const target = this.resolveTarget();
    const url = this.url(`${PROPOSAL_API_BASE_PATH}/${id}`, target);
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw await this.toRtError(
        response,
        `RT proposal get failed: ${response.status}`,
      );
    }

    return toProposal(await response.json() as RuntimeProposalPayload);
  }

  async createProposal(input: CreateProposalInput): Promise<Proposal> {
    const payload = await this.requestJson<RuntimeProposalPayload>(PROPOSAL_API_BASE_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(toRuntimeCreatePayload(input)),
    });
    return toProposal(payload);
  }

  async updateProposal(
    id: string,
    input: UpdateProposalInput,
  ): Promise<Proposal | null> {
    const target = this.resolveTarget();
    const url = this.url(`${PROPOSAL_API_BASE_PATH}/${id}`, target);
    const response = await this.fetchWithTimeout(url, {
      method: 'PATCH',
      headers: buildRuntimeAuthHeaders(target, {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      }),
      body: JSON.stringify(toRuntimeUpdatePayload(input)),
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw await this.toRtError(
        response,
        `RT proposal update failed: ${response.status}`,
      );
    }

    return toProposal(await response.json() as RuntimeProposalPayload);
  }

  async addComment(
    id: string,
    content: string,
    author: ProposalPublisher,
  ): Promise<Proposal> {
    const payload = await this.requestJson<RuntimeProposalPayload>(
      `${PROPOSAL_API_BASE_PATH}/${id}/comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          content,
          author: toRuntimePublisher(author),
        }),
      },
    );
    return toProposal(payload);
  }

  private buildListPath(filter?: ProposalQueryFilter): string {
    const url = new URL(PROPOSAL_API_BASE_PATH, 'http://runtime.local');
    if (filter?.status) {
      url.searchParams.set('status', filter.status);
    }
    if (filter?.actionType) {
      url.searchParams.set('action_type', filter.actionType);
    }
    return `${url.pathname}${url.search}`;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const target = this.resolveTarget();
    const url = this.url(path, target);
    const response = await this.fetchWithTimeout(url, {
      ...init,
      headers: buildRuntimeAuthHeaders(target, {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      }),
    });

    if (!response.ok) {
      throw await this.toRtError(
        response,
        `RT proposal request failed: ${response.status}`,
      );
    }

    return response.json() as Promise<T>;
  }

  private async toRtError(
    response: Response,
    message: string,
  ): Promise<ProposalRtError> {
    const body = await response.text().catch(() => '');
    return new ProposalRtError(message, response.status, body || undefined);
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${toRuntimeBaseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller?.signal,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const timeout = messageText.includes('abort') || messageText.includes('timeout');
      const message = timeout
        ? 'RT proposal request timed out（请求超时）'
        : `RT proposal request failed: ${error instanceof Error ? error.message : String(error)}`;
      console.warn('[proposal-rt][request] runtime request failed', {
        method: init?.method ?? 'GET',
        url,
        timeoutMs: this.timeoutMs,
        timeout,
        message,
      });
      throw new ProposalRtError(message, 0);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

let proposalRtAdapterInstance: ProposalRtAdapter | null = null;

export function getProposalRtAdapter(): ProposalRtAdapter {
  if (!proposalRtAdapterInstance) {
    proposalRtAdapterInstance = new ProposalRtAdapter();
  }
  return proposalRtAdapterInstance;
}
