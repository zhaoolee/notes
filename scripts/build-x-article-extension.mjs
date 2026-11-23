import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = new URL("../chrome-x-article/", import.meta.url);
const output = new URL("../dist-x-article-extension/", import.meta.url);

for (const entry of ["content", "notes"]) {
  await build({
    root,
    configFile: false,
    publicDir: false,
    define: { "process.env.NODE_ENV": '"production"' },
    esbuild: { jsx: "automatic" },
    build: {
      outDir: fileURLToPath(output),
      emptyOutDir: entry === "content",
      target: "es2022",
      lib: {
        entry: fileURLToPath(new URL(entry + ".ts", source)),
        name: "NotesXArticle",
        formats: ["iife"],
        fileName: () => entry + ".js",
      },
    },
  });
}

await Promise.all(["manifest.json", "background.js", "media.js", "popup.html", "status.css"].map(
  (name) => copyFile(new URL(name, source), new URL(name, output)),
));
console.log("Load this directory in Chrome:", fileURLToPath(output));
