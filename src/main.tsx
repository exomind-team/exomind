import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapBeforeRender } from "./bootstrap-before-render";
import { bootstrapRuntimeConfig } from "./config/runtime-config-cache";
import { hydratePersistedRuntimeTargetConfig } from "./config/runtime-target-mode";
import "./index.css";
import { syncDevtoolsWithSettings } from "./lib/debug/devtools-runtime";
import { ensureCryptoRandomUUID } from "./lib/utils/uuid";

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
  await syncDevtoolsWithSettings();
}

void bootstrapBeforeRender(bootstrapApp, renderApp);
