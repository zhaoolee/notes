import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SuperAdminPage } from "./components/SuperAdminPage";
import "./styles.css";

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const rootPage = pathname === "/superadmin" ? <SuperAdminPage /> : <App />;

createRoot(document.getElementById("root")!).render(
  <StrictMode>{rootPage}</StrictMode>,
);
