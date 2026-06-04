import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapBeforeRender } from "./bootstrap-before-render";
import { bootstrapRuntimeConfig } from "./config/runtime-config-cache";
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
  await hydratePersistedRuntimeTargetConfig();
  await bootstrapRuntimeConfig();

  // Bridge AI Registry → Runtime flat keys for built-in agents
  setOnRegistryChangeCallback(() => syncLLMSettingsToRuntimeFlatKeys());
  syncLLMSettingsToRuntimeFlatKeys();

  await syncDevtoolsWithSettings();
}

void bootstrapBeforeRender(bootstrapApp, renderApp);
