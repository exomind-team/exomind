import type { TaskPriority } from './task';

export type ProposalStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'snoozed';

export type ProposalActionType =
  | 'task.create'
  | 'task.update'
  | 'append_event'
  | 'start_timeblock'
  | 'approve_agent_access';

export type ProposalDependencyType = 'soft' | 'hard';

export interface ProposalTaskDependency {
  taskId: string;
  type: ProposalDependencyType;
}

export interface TaskCreateProposalFields {
  title: string;
  description?: string;
  doneCondition?: string;
  priority?: TaskPriority;
  tags?: string[];
  estimatedMinutes?: number;
  dueAt?: string;
  dependsOn?: ProposalTaskDependency[];
}

export interface TaskCreateProposalActionParams {
  fields: TaskCreateProposalFields;
}

export interface TaskUpdateProposalPatch {
  title?: string;
  description?: string | null;
  doneCondition?: string | null;
  priority?: TaskPriority;
  tags?: string[];
  estimatedMinutes?: number | null;
  dueAt?: string | null;
  dependsOn?: ProposalTaskDependency[];
}

export interface TaskUpdateProposalActionParams {
  taskId: string;
  patch: TaskUpdateProposalPatch;
}

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
