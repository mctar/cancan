import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

document.documentElement.style.setProperty("--font-display", '"Archivo Black"');
document.documentElement.style.setProperty("--font-sans", '"Inter"');
document.documentElement.style.setProperty("--font-mono", '"IBM Plex Mono"');

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
