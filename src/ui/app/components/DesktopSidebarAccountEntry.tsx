import { useState } from 'react';
import { getPreferredIdentityLink } from '@/lib/profile/identity-link-storage';
import { getLocalProfile } from '@/lib/profile/profile-storage';
import { useSyncStore } from '@/ui/stores/sync-store';
import { SwitchAccountSheet } from './SwitchAccountSheet';

function getLinkedIdentitySubtitle(input: {
  displayName?: string | null;
  remoteIdentityKey?: string | null;
} | null): string | null {
  if (!input) {
    return null;
  }

  const displayName = input.displayName?.trim();
  const remoteIdentityKey = input.remoteIdentityKey?.trim();
  if (displayName && displayName !== remoteIdentityKey) {
    return displayName;
  }

  return '已连接远端同步身份';
}

function getAvatarText(name: string | null): string {
  const normalized = name?.trim();
  return normalized ? normalized.charAt(0).toUpperCase() : '?';
}

export function DesktopSidebarAccountEntry({ collapsed = false }: { collapsed?: boolean }) {
  const { isLoggedIn, currentUser, activeProfileId } = useSyncStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'switch' | 'login' | 'register'>('login');

  const activeProfile = activeProfileId ? getLocalProfile(activeProfileId) : null;
  const linkedIdentity = activeProfileId ? getPreferredIdentityLink(activeProfileId) : null;

  const title = activeProfile?.displayName || currentUser || '未打开档案';
  const subtitle = getLinkedIdentitySubtitle(linkedIdentity)
    || (activeProfile ? `仅本地档案 · ${activeProfile.slug}` : '点击打开或创建本地档案');

  function handleOpen() {
    setSheetMode(isLoggedIn && activeProfile ? 'switch' : 'login');
    setSheetOpen(true);
  }

  return (
    <>
      {collapsed ? (
        <button
          type="button"
          data-testid="desktop-sidebar-account-entry"
          aria-label={`${title}，${subtitle}`}
          title={`${title} · ${subtitle}`}
          onClick={handleOpen}
          className="flex w-full items-center justify-center rounded-md px-2 py-2 transition-colors hover:bg-[hsl(var(--sidebar-accent))]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--sidebar-accent))] text-xs font-semibold text-[hsl(var(--sidebar-accent-foreground))]">
            {getAvatarText(title)}
          </div>
          <span className="sr-only">{title}</span>
          <span className="sr-only">{subtitle}</span>
        </button>
      ) : (
        <button
          type="button"
          data-testid="desktop-sidebar-account-entry"
          onClick={handleOpen}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[hsl(var(--sidebar-accent))]"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--sidebar-accent))] text-xs font-semibold text-[hsl(var(--sidebar-accent-foreground))]">
            {getAvatarText(title)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="truncate text-xs text-[hsl(var(--sidebar-muted))]">{subtitle}</p>
          </div>
        </button>
      )}

      <SwitchAccountSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialMode={sheetMode}
      />
    </>
  );
}
