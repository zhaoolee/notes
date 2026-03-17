import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT || 3001);
const supportedThemes = new Set(["default", "smartisan-dark"]);

let browserPromise;

function buildRenderUrl(baseUrl, theme) {
  const url = new URL("/", baseUrl);
  url.searchParams.set("renderMode", "playwright");
  url.searchParams.set("theme", theme);
  return url.toString();
}

function getRenderUrl(request, theme) {
  if (process.env.EXPORT_APP_URL) {
    return buildRenderUrl(process.env.EXPORT_APP_URL, theme);
  }

  const protocol = request.get("x-forwarded-proto") || request.protocol || "http";
  const host = request.get("x-forwarded-host") || request.get("host");
  return buildRenderUrl(`${protocol}://${host}`, theme);
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }

  return browserPromise;
}

async function resolveMarkdown(body) {
  if (typeof body.markdown === "string") {
    return body.markdown;
  }

  if (typeof body.markdownPath === "string" && body.markdownPath.trim()) {
    return fs.readFile(body.markdownPath, "utf8");
  }

  throw new Error("Missing markdown or markdownPath");
}

function resolveTheme(body) {
  if (typeof body.theme === "string" && supportedThemes.has(body.theme)) {
    return body.theme;
  }

  return "default";
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;

    const images = Array.from(document.images);
    await Promise.all(
      images.map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }),
    );
  });
}

async function waitForStableHeight(locator) {
  let previousHeight = -1;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const box = await locator.boundingBox();
    const currentHeight = Math.ceil(box?.height || 0);

    if (currentHeight > 0 && currentHeight === previousHeight) {
      return;
    }

    previousHeight = currentHeight;
    await locator.page().waitForTimeout(120);
  }
}

async function hasDistIndex() {
  try {
    await fs.access(path.join(distDir, "index.html"));
    return true;
  } catch {
    return false;
  }
}

async function renderNotePng(markdown, renderUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage({
    deviceScaleFactor: 3,
    viewport: { width: 1280, height: 960 },
  });

  try {
    await page.goto(renderUrl, {
      waitUntil: "networkidle",
    });

    const editor = page.locator("#markdown-editor");
    await editor.waitFor();
    await editor.fill(markdown);
    await waitForAssets(page);

    const noteSheet = page.locator(".note-sheet");
    await noteSheet.waitFor();
    await waitForStableHeight(noteSheet);

    return await noteSheet.screenshot({
      animations: "disabled",
      scale: "device",
      type: "png",
    });
  } finally {
    await page.close();
  }
}

const app = express();

app.use(express.json({ limit: "10mb" }));

app.post("/api/export", async (request, response) => {
  try {
    const markdown = await resolveMarkdown(request.body || {});
    const theme = resolveTheme(request.body || {});
    const filename =
      typeof request.body?.filename === "string" && request.body.filename.trim()
        ? request.body.filename.trim()
        : "note-export.png";

    const pngBuffer = await renderNotePng(markdown, getRenderUrl(request, theme));

    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    response.send(pngBuffer);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to export note image";
    const isBrowserInstallError =
      message.includes("Executable doesn't exist") ||
      message.includes("Please run the following command");

    console.error("Export request failed:", error);

    response.status(500).json({
      error: message,
      hint: isBrowserInstallError
        ? "Run `npx playwright install chromium` on this machine."
        : undefined,
    });
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

if (await hasDistIndex()) {
  app.use(express.static(distDir));

  app.get("/{*any}", (_request, response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
}

const server = app.listen(port, () => {
  console.log(`Backend listening on http://127.0.0.1:${port}`);
});

async function closeBrowser() {
  if (!browserPromise) {
    return;
  }

  const browser = await browserPromise;
  await browser.close();
  browserPromise = undefined;
}

async function shutdown(exitCode) {
  server.close(async () => {
    await closeBrowser();
    process.exit(exitCode);
  });
}

process.on("SIGINT", () => {
  void shutdown(130);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});
