import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ExoMindEnvironment, type IASRPort } from '@exomind/core';
import { WebStorageAdapter } from '@exomind/core';

// Initialize environment for web
const storageAdapter = new WebStorageAdapter();

// Create a stub ASR adapter for web
const stubASRAdapter: IASRPort = {
  configure: () => {},
  getSupportedLanguages: () => ['zh-CN', 'en-US'],
  transcribe: async () => ({ text: '', confidence: 0, lang: 'zh-CN' }),
  streamTranscribe: async function* () { yield { text: '', isFinal: false }; },
  isAvailable: () => false,
};

// Initialize the environment
ExoMindEnvironment.create(stubASRAdapter, storageAdapter);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
