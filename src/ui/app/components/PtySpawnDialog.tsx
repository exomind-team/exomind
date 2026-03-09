import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Terminal } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────

interface ClaudeSessionInfo {
  session_id: string;
  project: string;
  last_active: string; // ISO 8601
}

export interface PtySpawnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rtBaseUrl: string;
  authToken?: string;
  onSpawned: (info: { id: string; name: string }) => void;
}

// ── Helpers ────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return isoString;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return '刚刚';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;

  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

// ── Component ──────────────────────────────────────────────────

export function PtySpawnDialog({
  open,
  onOpenChange,
  rtBaseUrl,
  authToken,
  onSpawned,
}: PtySpawnDialogProps) {
  const [name, setName] = useState('');
  const [workdir, setWorkdir] = useState('');
  const [sessions, setSessions] = useState<ClaudeSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Build auth headers ──────────────────────────────────────

  const buildHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  }, [authToken]);

  // ── Reset state when dialog closes ──────────────────────────

  useEffect(() => {
    if (!open) {
      setName('');
      setWorkdir('');
      setSessions([]);
      setLoading(false);
      setError('');
    }
  }, [open]);

  // ── Fetch Claude sessions on open ───────────────────────────

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const fetchSessions = async () => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }
        const res = await fetch(`${rtBaseUrl}/pty/claude-sessions`, { headers });
        if (!res.ok) {
          // Non-critical: sessions list is optional
          return;
        }
        const data: ClaudeSessionInfo[] = await res.json();
        if (!cancelled) {
          setSessions(data);
        }
      } catch {
        // Silently ignore — session list is a convenience feature
      }
    };

    void fetchSessions();

    return () => {
      cancelled = true;
    };
  }, [open, rtBaseUrl, authToken]);

  // ── Spawn new session ───────────────────────────────────────

  const handleSpawn = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const body: Record<string, string> = {};
      if (name.trim()) body.name = name.trim();
      if (workdir.trim()) body.workdir = workdir.trim();

      const res = await fetch(`${rtBaseUrl}/pty/spawn`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const result: { id: string; name: string } = await res.json();
      onSpawned(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [name, workdir, rtBaseUrl, buildHeaders, onSpawned, onOpenChange]);

  // ── Resume existing session ─────────────────────────────────

  const handleResume = useCallback(
    async (session: ClaudeSessionInfo) => {
      setLoading(true);
      setError('');

      try {
        const body: Record<string, string> = {
          session_id: session.session_id,
        };
        if (name.trim()) body.name = name.trim();
        if (workdir.trim()) body.workdir = workdir.trim();

        const res = await fetch(`${rtBaseUrl}/pty/resume`, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }

        const result: { id: string; name: string } = await res.json();
        onSpawned(result);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [name, workdir, rtBaseUrl, buildHeaders, onSpawned, onOpenChange],
  );

  // ── Render ──────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>启动终端会话</DialogTitle>
          <DialogDescription>启动新的 PTY 会话或恢复已有的 Claude 会话</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* ── Name input ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">名称（可选）</label>
            <input
              type="text"
              placeholder="my-terminal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-full rounded-lg border border-border-card bg-card px-3 text-sm outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A]"
              disabled={loading}
            />
          </div>

          {/* ── Workdir input ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">工作目录（可选）</label>
            <input
              type="text"
              placeholder="D:\project\exomind"
              value={workdir}
              onChange={(e) => setWorkdir(e.target.value)}
              className="h-9 w-full rounded-lg border border-border-card bg-card px-3 text-sm outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A]"
              disabled={loading}
            />
          </div>

          {/* ── Error ── */}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          {/* ── Spawn button ── */}
          <button
            type="button"
            onClick={handleSpawn}
            disabled={loading}
            className="w-full rounded-[14px] bg-[#C75B3A] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[#B5502F] transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                启动中...
              </span>
            ) : (
              '启动新会话'
            )}
          </button>

          {/* ── Session list ── */}
          {sessions.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">恢复已有会话</div>
              <div className="max-h-[200px] space-y-1.5 overflow-y-auto">
                {sessions.map((session) => (
                  <button
                    key={session.session_id}
                    type="button"
                    onClick={() => handleResume(session)}
                    disabled={loading}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-border-card bg-card px-3 py-2 text-sm text-left hover:bg-muted/50 disabled:opacity-50 transition-colors"
                  >
                    <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{session.project || session.session_id.slice(0, 12)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatRelativeTime(session.last_active)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
