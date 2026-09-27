import React from "react";
import ReactDOM from "react-dom/client";
import { ActionDockPage } from "./ui/action-dock/ActionDockPage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ActionDockPage />
  </React.StrictMode>,
);
