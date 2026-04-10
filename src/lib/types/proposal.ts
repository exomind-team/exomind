export type ProposalStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'snoozed';

export type ProposalActionType =
  | 'create_task'
  | 'append_event'
  | 'start_timeblock'
  | 'approve_agent_access';

export type ProposalReferenceType = 'event' | 'timeblock' | 'task';
export type ProposalPublisherType = 'agent' | 'human';

export interface ProposalReference {
  refType: ProposalReferenceType;
  id: string;
  displayText: string;
}

export interface ProposalPublisher {
  publisherType: ProposalPublisherType;
  id: string;
  name: string;
}

export interface ProposalComment {
  author: ProposalPublisher;
  content: string;
  createdAt: string;
}

export interface Proposal {
  id: string;
  title: string;
  body: string;
  actionType: ProposalActionType;
  actionParams: Record<string, unknown>;
  references: ProposalReference[];
  status: ProposalStatus;
  publisher: ProposalPublisher;
  comments: ProposalComment[];
  createdAt: string;
  updatedAt: string;
  snoozeUntil?: string;
}

export interface CreateProposalInput {
  title: string;
  body?: string;
  actionType: ProposalActionType;
  actionParams: Record<string, unknown>;
  references?: ProposalReference[];
  publisher: ProposalPublisher;
}

export interface UpdateProposalInput {
  status?: ProposalStatus;
  actionParams?: Record<string, unknown>;
  snoozeUntil?: string | null;
}
