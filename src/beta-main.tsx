import React from 'react';
import ReactDOM from 'react-dom/client';
import { BetaApp } from './beta/BetaApp';
import { applyBetaMobileDisplayPreference, initializeBetaUuid } from './beta/initialization';
import { errorMessage } from './beta/drafts';
import './index.css';

function BetaEntry() {
  const [displayError, setDisplayError] = React.useState('');
  React.useEffect(() => { void applyBetaMobileDisplayPreference().catch(error => setDisplayError(errorMessage(error))); }, []);
  return <div className="flex h-full flex-col">
    {displayError && <p role="alert" className="shrink-0 bg-page px-5 py-2 text-sm text-destructive dark:bg-page-dark">系统栏显示设置未能应用：{displayError}</p>}
    <div className="min-h-0 flex-1"><BetaApp /></div>
  </div>;
}
const root = ReactDOM.createRoot(document.getElementById('root')!);
try {
  initializeBetaUuid();
  root.render(<React.StrictMode><BetaEntry /></React.StrictMode>);
} catch (failure) {
  root.render(<main className="flex h-full items-center justify-center bg-page p-5 dark:bg-page-dark"><p role="alert" className="text-destructive">{errorMessage(failure)}</p></main>);
}
