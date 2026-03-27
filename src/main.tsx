import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootstrapBeforeRender } from "./bootstrap-before-render";
import { bootstrapRuntimeConfig } from "./config/runtime-config-cache";
import "./index.css";
import { syncDevtoolsWithSettings } from "./lib/debug/devtools-runtime";
import { ensureCryptoRandomUUID } from "./lib/utils/uuid";

ensureCryptoRandomUUID();
void syncDevtoolsWithSettings();

function renderApp(): void {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrapBeforeRender(bootstrapRuntimeConfig, renderApp);
