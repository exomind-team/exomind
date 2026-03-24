import React from 'react';
import ReactDOM from 'react-dom/client';
import { NowWorkbenchOverlayPage } from './pages/NowWorkbenchOverlayPage';
import './index.css';

document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';
document.body.style.overflow = 'hidden';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <NowWorkbenchOverlayPage />
  </React.StrictMode>,
);
