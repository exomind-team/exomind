const USE_MOCK_DATA_STORAGE_KEY = 'exomind:useMockData'; // mock data flag（测试数据开关）存储键
const USE_MOCK_DATA_CHANGED_EVENT = 'exomind:use-mock-data-changed'; // custom event（自定义事件）

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getUseMockDataEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return normalizeBoolean(window.localStorage.getItem(USE_MOCK_DATA_STORAGE_KEY));
}

export function setUseMockDataEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USE_MOCK_DATA_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(USE_MOCK_DATA_CHANGED_EVENT, { detail: enabled }));
}

// ── Mock Session Data ──────────────────────────────────────────
import type { SessionInfo } from '@/lib/types/session';

/** Mock sessions for V1 development — controlled by "使用测试数据" toggle */
export const MOCK_SESSIONS: SessionInfo[] = [
  {
    id: 'mock-session-1',
    agent_kind: 'claude',
    role: '任务思考',
    summary: '分析 #511 拆解方案，建议将 user.input 拆为三层...',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-mock-1',
    context: {
      git_branch: 'dev',
      issue_refs: ['#511'],
      labels: ['规划性'],
    },
    created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    last_active_at: new Date(Date.now() - 30_000).toISOString(),
    turn_count: 8,
    last_output_preview: '> 建议将 user.input 拆为三层：raw_input → normalized → parsed',
  },
  {
    id: 'mock-session-2',
    agent_kind: 'claude',
    role: 'PR迁移',
    summary: 'bun test 7/7 passed — rt-sql 迁移完成',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-mock-2',
    context: {
      git_branch: 'feature/pr506-rt-sql-migration',
      issue_refs: ['#506'],
      pr_ref: '#506',
      labels: [],
    },
    created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
    last_active_at: new Date(Date.now() - 15_000).toISOString(),
    turn_count: 12,
    last_output_preview: '$ bun test\n✓ task_runtime_sqlite\n✓ session_store\n7/7 tests passed',
  },
  {
    id: 'mock-session-3',
    agent_kind: 'claude',
    role: '代码审查',
    summary: '等待确认测试方案 A/B',
    status: 'waiting_input',
    interaction_mode: 'structured',
    context: {
      git_branch: 'dev',
      issue_refs: ['#511'],
      labels: [],
    },
    created_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    last_active_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    turn_count: 5,
    last_output_preview: '等待确认测试方案：\n  A) 只测 normalizer\n  B) 端到端含 voice→parse',
    quick_actions: [
      { id: 'qa-a', label: '方案 A', action_type: 'button' as const, payload: 'plan_a', description: '只测 normalizer' },
      { id: 'qa-b', label: '方案 B', action_type: 'button' as const, payload: 'plan_b', description: '端到端含 voice→parse' },
      { id: 'qa-custom', label: '自定义', action_type: 'text_input' as const, description: '输入你的方案...' },
    ],
  },
  {
    id: 'mock-session-4',
    agent_kind: 'codex',
    role: '语音输入',
    summary: 'bun install 完成，准备运行测试',
    status: 'running',
    interaction_mode: 'terminal',
    pty_id: 'pty-mock-4',
    context: {
      git_branch: 'feature/issue-511-voice-input',
      issue_refs: ['#511'],
      worktree_path: 'D:/project/exomind-wt-ab12',
      labels: [],
    },
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    last_active_at: new Date(Date.now() - 10_000).toISOString(),
    turn_count: 3,
    last_output_preview: '$ bun install\n861 packages installed [10.94s]',
  },
];

export function subscribeUseMockDataChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== USE_MOCK_DATA_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(USE_MOCK_DATA_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(USE_MOCK_DATA_CHANGED_EVENT, handleCustomEvent);
  };
}

