import React from "react";
import ReactDOM from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { App } from "./app/App";
import { installPrototypeAnimConsoleHelper } from "./features/app-fullscreen/prototypeWindowAnim";
import i18n, { initI18n } from "./shared/i18n/i18n.ts";
import "./shared/styles/global.scss";

installPrototypeAnimConsoleHelper();
initI18n();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </React.StrictMode>,
);
