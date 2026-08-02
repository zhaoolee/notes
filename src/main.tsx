import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import changelogMarkdown from "../CHANGELOG.md?raw";
import App from "./App";
import { ChangelogPage } from "./components/ChangelogPage";
import { SuperAdminPage } from "./components/SuperAdminPage";
import "./styles.css";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const rootPage =
  pathname === "/superadmin" ? (
    <SuperAdminPage />
  ) : pathname === "/changelog" ? (
    <ChangelogPage markdown={changelogMarkdown} />
  ) : (
    <App />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{rootPage}</StrictMode>,
);
