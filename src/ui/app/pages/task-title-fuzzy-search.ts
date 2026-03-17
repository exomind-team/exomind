import type { TaskNode } from '@/lib/types/task';

function normalizeFuzzyText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '');
}

function countCharOccurrences(text: string, target: string): number {
  let count = 0;
  for (const char of text) {
    if (char === target) {
      count += 1;
    }
  }
  return count;
}

export function extractTaskTitleSearchQuery(inputValue: string): string {
  const [firstLine = ''] = inputValue.split(/\r?\n/, 1);
  return normalizeFuzzyText(firstLine.trim());
}

export function getTaskTitleFuzzyScore(title: string, query: string): number | null {
  const normalizedTitle = normalizeFuzzyText(title);
  const normalizedQuery = normalizeFuzzyText(query);
  if (!normalizedQuery) return 0;

  let score = 0;
  for (const queryChar of normalizedQuery) {
    const occurrences = countCharOccurrences(normalizedTitle, queryChar);
    if (occurrences === 0) {
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
    .map((task) => ({
      task,
      score: getTaskTitleFuzzyScore(task.title, normalizedQuery),
    }))
    .filter((entry): entry is { task: TaskNode; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || left.task.title.localeCompare(right.task.title, 'zh-CN'))
    .map((entry) => entry.task);
}
