import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,
    watch: process.env.VITE_USE_POLLING
      ? {
          usePolling: true,
          interval: 120,
        }
      : undefined,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3001",
      },
    },
  },
});
