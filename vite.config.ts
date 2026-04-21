import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "serve-all-icons-png",
      configureServer(server) {
        server.middlewares.use("/all_icons.png", (_request, response, next) => {
          const filePath = path.resolve(server.config.publicDir, "all_icons.png");

          if (!fs.existsSync(filePath)) {
            next();
            return;
          }

          response.setHeader("Content-Type", "image/png");
          fs.createReadStream(filePath).pipe(response);
        });
      },
    },
  ],
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
      "/images": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3001",
      },
    },
  },
});
