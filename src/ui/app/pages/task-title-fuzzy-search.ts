import type { TaskNode } from '@/lib/types/task';

function normalizeFuzzyText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

function buildCharCountMap(text: string): Map<string, number> {
  const countMap = new Map<string, number>();
  for (const char of text) {
    countMap.set(char, (countMap.get(char) ?? 0) + 1);
  }
  return countMap;
}

function getLongestCommonSubstringLength(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  const dp = new Array<number>(right.length + 1).fill(0);
  let maxLength = 0;

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = right.length; rightIndex >= 1; rightIndex -= 1) {
      if (left[leftIndex - 1] === right[rightIndex - 1]) {
        dp[rightIndex] = dp[rightIndex - 1] + 1;
        maxLength = Math.max(maxLength, dp[rightIndex]);
      } else {
        dp[rightIndex] = 0;
      }
    }
  }

  return maxLength;
}

export function extractTaskTitleSearchQuery(inputValue: string): string {
  const [firstLine = ''] = inputValue.split(/\r?\n/, 1);
  return firstLine.trim();
}

export function getTaskTitleFuzzyScore(title: string, query: string): number | null {
  const normalizedTitle = normalizeFuzzyText(title);
  const normalizedQuery = normalizeFuzzyText(query);
  if (!normalizedQuery) return 0;

  const titleCharCountMap = buildCharCountMap(normalizedTitle);
  const queryCharCountMap = buildCharCountMap(normalizedQuery);
  let score = 0;
  for (const [queryChar, requiredOccurrences] of queryCharCountMap) {
    const occurrences = titleCharCountMap.get(queryChar) ?? 0;
    if (occurrences < requiredOccurrences) {
      return null;
    }
    score += occurrences;
  }

  return score;
}

export function filterTasksByTitleFuzzySearch(tasks: TaskNode[], query: string): TaskNode[] {
  const normalizedQuery = normalizeFuzzyText(query);
  if (!normalizedQuery) {
    return tasks;
  }

  return tasks
    .map((task) => {
      const normalizedTitle = normalizeFuzzyText(task.title);
      return {
        task,
        score: getTaskTitleFuzzyScore(normalizedTitle, normalizedQuery),
        longestSubstringLength: getLongestCommonSubstringLength(normalizedTitle, normalizedQuery),
      };
    })
    .filter((entry): entry is { task: TaskNode; score: number; longestSubstringLength: number } => entry.score !== null)
    .sort((left, right) => (
      right.longestSubstringLength - left.longestSubstringLength
      || right.score - left.score
      || left.task.title.localeCompare(right.task.title, 'zh-CN')
    ))
    .map((entry) => entry.task);
}

export interface TaskDagSearchOptions {
  includeDescription: boolean;
  fuzzy: boolean;
  filterMode: boolean;
}

function buildSearchText(task: TaskNode, includeDescription: boolean): string {
  return includeDescription
    ? `${task.title} ${task.description ?? ''}`
    : task.title;
}

export function filterTasksBySearch(
  tasks: TaskNode[],
  query: string,
  options: Pick<TaskDagSearchOptions, 'includeDescription' | 'fuzzy'>,
): TaskNode[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return tasks;
  }

  if (!options.fuzzy) {
    const loweredQuery = trimmedQuery.toLocaleLowerCase();
    return tasks.filter((task) => buildSearchText(task, options.includeDescription).toLocaleLowerCase().includes(loweredQuery));
  }

  const normalizedQuery = normalizeFuzzyText(trimmedQuery);
  return tasks
    .map((task) => {
      const normalizedText = normalizeFuzzyText(buildSearchText(task, options.includeDescription));
      return {
        task,
        score: getTaskTitleFuzzyScore(normalizedText, normalizedQuery),
        longestSubstringLength: getLongestCommonSubstringLength(normalizedText, normalizedQuery),
      };
    })
    .filter((entry): entry is { task: TaskNode; score: number; longestSubstringLength: number } => entry.score !== null)
    .sort((left, right) => (
      right.longestSubstringLength - left.longestSubstringLength
      || right.score - left.score
      || left.task.title.localeCompare(right.task.title, 'zh-CN')
    ))
    .map((entry) => entry.task);
}
