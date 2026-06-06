import React from 'react';
import ReactDOM from 'react-dom/client';
import { NowWorkbenchOverlayPage } from './pages/NowWorkbenchOverlayPage';
import { bootstrapBeforeRender } from './bootstrap-before-render';
import { fetchEmbeddedPortFromIpc } from './config/runtime-target';
import { hydratePersistedRuntimeTargetConfig } from './config/runtime-target-mode';
import './index.css';

document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';
document.body.style.overflow = 'hidden';

function renderApp(): void {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <NowWorkbenchOverlayPage />
    </React.StrictMode>,
  );
}

async function bootstrapApp(): Promise<void> {
  await fetchEmbeddedPortFromIpc();
  await hydratePersistedRuntimeTargetConfig();
}

void bootstrapBeforeRender(bootstrapApp, renderApp);
