import "./presetBoot";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";
import "./ui/ui.css";

// The independent boot script registers the service worker even when a
// stale cached bundle prevents this module from executing.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
