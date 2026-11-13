import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { listLocalProfiles } from '@/lib/profile/profile-storage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { SwitchAccountSheet } from './SwitchAccountSheet';

/** Recording and timers require an opened local profile, regardless of network state. */
export function LocalProfileGuard({ children }: { children: ReactNode }) {
  const { activeProfileId, isLoggedIn } = useSyncStore();
  const [mode, setMode] = useState<'switch' | 'login' | 'register'>('register');
  const [open, setOpen] = useState(false);
  const ready = Boolean(isLoggedIn && activeProfileId);
  useEffect(() => { if (ready) setOpen(false); }, [ready]);
  if (ready) return <>{children}</>;

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background px-6 py-8">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold">先打开本地档案</h1>
        <p className="text-sm text-muted-foreground">记录和时间块保存在本机档案里，无需联网。已有草稿会保留。</p>
        <Button className="w-full" onClick={() => { setMode('register'); setOpen(true); }}>创建本地档案</Button>
        <Button className="w-full" variant="outline" onClick={() => {
          setMode(listLocalProfiles().length > 0 ? 'switch' : 'login');
          setOpen(true);
        }}>打开已有档案</Button>
      </div>
      <SwitchAccountSheet open={open} onOpenChange={setOpen} initialMode={mode} />
    </div>
  );
}
