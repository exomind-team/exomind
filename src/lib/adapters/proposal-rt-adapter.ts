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
  ProposalComment,
  ProposalPublisher,
  ProposalReference,
  ProposalStatus,
  UpdateProposalInput,
} from '@/lib/types/proposal';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

interface RuntimeProposalReferencePayload {
  ref_type: ProposalReference['refType'];
  id: string;
  display_text: string;
}

interface RuntimeProposalPublisherPayload {
  publisher_type: ProposalPublisher['publisherType'];
  id: string;
  name: string;
}

interface RuntimeProposalCommentPayload {
  author: RuntimeProposalPublisherPayload;
  content: string;
  created_at: string;
}

interface RuntimeProposalPayload {
  id: number;
  title: string;
  body?: string | null;
  action_type: ProposalActionType;
  action_params?: Record<string, unknown> | null;
  references?: RuntimeProposalReferencePayload[] | null;
  status: ProposalStatus;
  publisher: RuntimeProposalPublisherPayload;
  comments?: RuntimeProposalCommentPayload[] | null;
  created_at: string;
  updated_at: string;
  snooze_until?: string | null;
}

const PROPOSAL_API_BASE_PATH = '/api/proposals';

export interface ProposalQueryFilter {
  status?: ProposalStatus;
  actionType?: ProposalActionType;
}

export interface ProposalRtAdapterOptions {
  fetchImpl?: RuntimeFetch;
  resolveTarget?: () => RuntimeTarget;
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

function toProposalReference(
  payload: RuntimeProposalReferencePayload,
): ProposalReference {
  return {
    refType: payload.ref_type,
    id: payload.id,
    displayText: payload.display_text,
  };
}

function toProposalPublisher(
  payload: RuntimeProposalPublisherPayload,
): ProposalPublisher {
  return {
    publisherType: payload.publisher_type,
    id: payload.id,
    name: payload.name,
  };
}

function toProposalComment(payload: RuntimeProposalCommentPayload): ProposalComment {
  return {
    author: toProposalPublisher(payload.author),
    content: payload.content,
    createdAt: payload.created_at,
  };
}

function toProposal(payload: RuntimeProposalPayload): Proposal {
  return {
    id: payload.id,
    title: payload.title,
    body: payload.body ?? '',
    actionType: payload.action_type,
    actionParams: payload.action_params ?? {},
    references: (payload.references ?? []).map(toProposalReference),
    status: payload.status,
    publisher: toProposalPublisher(payload.publisher),
    comments: (payload.comments ?? []).map(toProposalComment),
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
    ...(payload.snooze_until ? { snoozeUntil: payload.snooze_until } : {}),
  };
}

function toRuntimeReference(
  reference: ProposalReference,
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

  constructor(options: ProposalRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async listProposals(filter?: ProposalQueryFilter): Promise<Proposal[]> {
    const payload = await this.requestJson<RuntimeProposalPayload[]>(
      this.buildListPath(filter),
    );
    return payload.map(toProposal);
  }

  async getProposal(id: number): Promise<Proposal | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`${PROPOSAL_API_BASE_PATH}/${id}`, target), {
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
    id: number,
    input: UpdateProposalInput,
  ): Promise<Proposal | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`${PROPOSAL_API_BASE_PATH}/${id}`, target), {
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
    id: number,
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
    const response = await this.fetchImpl(this.url(path, target), {
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
}

let proposalRtAdapterInstance: ProposalRtAdapter | null = null;

export function getProposalRtAdapter(): ProposalRtAdapter {
  if (!proposalRtAdapterInstance) {
    proposalRtAdapterInstance = new ProposalRtAdapter();
  }
  return proposalRtAdapterInstance;
}
