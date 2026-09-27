import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapBeforeRender } from "./bootstrap-before-render";
import { bootstrapRuntimeConfig } from "./config/runtime-config-cache";
import { fetchEmbeddedPortFromIpc } from "./config/runtime-target";
import { hydratePersistedRuntimeTargetConfig } from "./config/runtime-target-mode";
import "./index.css";
import { syncDevtoolsWithSettings } from "./lib/debug/devtools-runtime";
import { ensureCryptoRandomUUID } from "./lib/utils/uuid";
import { setOnRegistryChangeCallback } from "./lib/ai-registry/admin";
import { syncLLMSettingsToRuntimeFlatKeys } from "./config/llm-settings";

ensureCryptoRandomUUID();
function renderApp(): void {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

async function bootstrapApp(): Promise<void> {
  // 渲染前从 Tauri IPC 获取真实 runtime 端口，确保后续所有 API 调用使用正确端口
  await fetchEmbeddedPortFromIpc();
  await hydratePersistedRuntimeTargetConfig();
  await bootstrapRuntimeConfig();

  // Bridge AI Registry → Runtime flat keys for built-in agents
  setOnRegistryChangeCallback(() => syncLLMSettingsToRuntimeFlatKeys());
  syncLLMSettingsToRuntimeFlatKeys();

  await syncDevtoolsWithSettings();
}

void bootstrapBeforeRender(bootstrapApp, renderApp);
