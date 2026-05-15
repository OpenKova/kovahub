import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { kovaRoboLogo } from "./brandAssets";
import "./styles.css";

const favicon = document.querySelector<HTMLLinkElement>("link[rel~='icon']") ?? document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/png";
favicon.href = kovaRoboLogo;

if (!favicon.parentNode) {
  document.head.appendChild(favicon);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
