export interface ExistingBranchPr {
  number: number;
  title: string;
}

export interface PlanPrSyncInput {
  existingPr: ExistingBranchPr | null;
  baseBranch: string;
  title?: string;
  explicitBody?: string;
  explicitBodyFile?: string;
  defaultBodyFile: string;
  defaultBodyExists: boolean;
}

export type PlannedBodyMode = 'none' | 'text' | 'file';

export type PrSyncPlan =
  | {
      mode: 'create';
      baseBranch: string;
      title: string;
      bodyMode: Exclude<PlannedBodyMode, 'none'>;
      bodyValue: string;
    }
  | {
      mode: 'update';
      prNumber: number;
      title?: string;
      bodyMode: PlannedBodyMode;
      bodyValue?: string;
    }
  | {
      mode: 'noop';
      prNumber: number;
    };

function resolveBodySource(input: PlanPrSyncInput): {
  mode: PlannedBodyMode;
  value?: string;
} {
  if (input.explicitBody) {
    return {
      mode: 'text',
      value: input.explicitBody,
    };
  }

  if (input.explicitBodyFile) {
    return {
      mode: 'file',
      value: input.explicitBodyFile,
    };
  }

  if (input.defaultBodyExists) {
    return {
      mode: 'file',
      value: input.defaultBodyFile,
    };
  }

  return {
    mode: 'none',
  };
}

export function planPrSync(input: PlanPrSyncInput): PrSyncPlan {
  const body = resolveBodySource(input);

  if (input.existingPr) {
    if (!input.title && body.mode === 'none') {
      return {
        mode: 'noop',
        prNumber: input.existingPr.number,
      };
    }

    return {
      mode: 'update',
      prNumber: input.existingPr.number,
      title: input.title,
      bodyMode: body.mode,
      bodyValue: body.value,
    };
  }

  if (!input.title) {
    throw new Error('PR sync requires a title when creating a new draft PR.');
  }

  if (body.mode === 'none' || !body.value) {
    throw new Error('PR sync requires body content or a body file when creating a new draft PR.');
  }

  return {
    mode: 'create',
    baseBranch: input.baseBranch,
    title: input.title,
    bodyMode: body.mode,
    bodyValue: body.value,
  };
}
