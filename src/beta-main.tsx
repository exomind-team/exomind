import React from 'react';
import ReactDOM from 'react-dom/client';
import { BetaApp } from './beta/BetaApp';
import { applyBetaMobileDisplayPreference, initializeBetaUuid } from './beta/initialization';
import { errorMessage } from './beta/drafts';
import { isBetaMockProfileRequested } from './beta/dev-mock-mode';
import { initQuickExitShortcutRuntime } from './services/quick-exit-shortcut-runtime';
import type { BetaMockProfile } from './beta/dev-mock-profile';
import './index.css';
import './beta/beta-ui.css';

document.documentElement.classList.add('beta-ui');
const mockMode = isBetaMockProfileRequested(window.location.search, import.meta.env.DEV);

function BetaEntry() {
  const [displayError, setDisplayError] = React.useState('');
  const [mockProfile, setMockProfile] = React.useState<BetaMockProfile | null>(null);
  React.useEffect(() => {
    if (mockMode) {
      let active = true;
      void import('./beta/dev-mock-profile').then(({ createBetaMockProfile }) => {
        if (active) setMockProfile(createBetaMockProfile());
      }).catch(error => { if (active) setDisplayError(errorMessage(error)); });
      return () => { active = false; };
    }
    void applyBetaMobileDisplayPreference().catch(error => setDisplayError(errorMessage(error)));
  }, []);

  if (mockMode && !mockProfile) {
    return <div className="flex h-full items-center justify-center p-5" role={displayError ? 'alert' : 'status'}>
      {displayError || '正在准备内存测试档案…'}
    </div>;
  }

  return <div className="flex h-full flex-col">
    {displayError && <p role="alert" className="shrink-0 bg-page px-5 py-2 text-sm text-destructive dark:bg-page-dark">系统栏显示设置未能应用：{displayError}</p>}
    {mockMode && mockProfile && <div className="flex shrink-0 items-center gap-3 border-b border-border-page bg-page px-4 py-2 text-xs text-secondary dark:bg-page-dark" data-testid="beta-mock-profile-banner">
      <p role="status" className="min-w-0 flex-1">内存测试档案：事件、附件和时间块只存在于本页面；刷新或重置后恢复为合成样本。</p>
      <button type="button" className="rounded-md border border-border-page px-2 py-1" data-testid="beta-mock-profile-reset"
        onClick={() => { void import('./beta/dev-mock-profile').then(({ createBetaMockProfile }) => setMockProfile(createBetaMockProfile())); }}>
        重置测试档案
      </button>
    </div>}
    <div className="min-h-0 flex-1"><BetaApp key={mockProfile?.instanceId ?? 'live'} client={mockProfile?.client}
      sourceStore={mockProfile?.sourceStore} intentJournal={mockProfile?.intentJournal}
      peers={mockProfile?.peers} handoffs={mockProfile?.handoffs} shareHandoffs={mockProfile?.shareHandoffs}/></div>
  </div>;
}
const root = ReactDOM.createRoot(document.getElementById('root')!);
try {
  if (!mockMode) {
    initializeBetaUuid();
    void initQuickExitShortcutRuntime({
      exitCommand: 'beta_request_exit',
      bindingSource: 'persisted-settings',
    });
  }
  root.render(<React.StrictMode><BetaEntry /></React.StrictMode>);
} catch (failure) {
  root.render(<main className="flex h-full items-center justify-center bg-page p-5 dark:bg-page-dark"><p role="alert" className="text-destructive">{errorMessage(failure)}</p></main>);
}
