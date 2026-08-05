import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import changelogMarkdown from "../CHANGELOG.md?raw";
import App from "./App";
import { ChangelogPage } from "./components/ChangelogPage";
import { PromoStudioPage } from "./components/PromoStudioPage";
import { SuperAdminPage } from "./components/SuperAdminPage";
import { installAutoHideScrollbars } from "./lib/auto-hide-scrollbars";
import { getPageTitle } from "./lib/page-title";
import "./styles.css";

document.title = getPageTitle(window.location.hostname);
installAutoHideScrollbars();

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const rootPage =
  pathname === "/superadmin" ? (
    <SuperAdminPage />
  ) : pathname === "/changelog" ? (
    <ChangelogPage markdown={changelogMarkdown} />
  ) : pathname === "/promo/editor" ? (
    <PromoStudioPage mode="editor" />
  ) : pathname === "/promo/pages" ? (
    <PromoStudioPage mode="pages" />
  ) : (
    <App />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{rootPage}</StrictMode>,
);
