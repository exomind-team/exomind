import React from "react";
import ReactDOM from "react-dom/client";
import { VoiceOverlayPage } from "./pages/VoiceOverlayPage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <VoiceOverlayPage />
  </React.StrictMode>,
);
