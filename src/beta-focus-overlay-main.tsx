import React from 'react';
import ReactDOM from 'react-dom/client';
import { BetaOverlayPage } from './beta/overlay/BetaOverlayPage';
import { initializeBetaUuid } from './beta/initialization';
import './index.css';

document.documentElement.style.background='transparent';
document.body.style.background='transparent';
document.body.style.overflow='hidden';
const root=ReactDOM.createRoot(document.getElementById('root')!);
try{initializeBetaUuid();root.render(<React.StrictMode><BetaOverlayPage/></React.StrictMode>);}
catch{root.render(<p role="alert" className="rounded-[24px] bg-[#1C1917] p-5 text-sm text-[#FAFAF9]">浮窗初始化失败，请回到主程序</p>);}
