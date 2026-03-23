export interface MorningPlanCandidate {
  id: string;
  title: string;
  targetOutcome: string;
  suggestedWindows: string[];
}

export interface BuildMorningPlanCandidatesInput {
  carryOverTask?: string | null;
  blockers?: string[];
  fixedPoints?: string[];
  energy?: 'low' | 'medium' | 'high';
}

export function buildMorningPlanCandidates(input: BuildMorningPlanCandidatesInput): MorningPlanCandidate[] {
  const base = input.carryOverTask?.trim() || '先推进今天最关键的一步';
  const blocker = input.blockers?.[0]?.trim() || '清掉当前最影响推进的阻塞';

  return [
    {
      id: 'carry-over',
      title: base,
      targetOutcome: '把今天主线往前推进一个可见结果',
      suggestedWindows: ['上午先开一段', ...(input.fixedPoints ?? []).slice(0, 1)],
    },
    {
      id: 'blocker-cleanup',
      title: '先清掉一个阻塞项',
      targetOutcome: blocker,
      suggestedWindows: ['下午补一段'],
    },
  ].slice(0, 3);
}
