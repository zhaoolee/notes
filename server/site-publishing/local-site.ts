import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { Router } from "express";
import type { SiteZipEntry } from "./build.js";

export const LOCAL_SITE_BASE_PATH = "/notes/";
const OUTPUT_PREFIX = "notes-hugo-site/public/";
interface ReleasePointer { version: 1; releaseId: string; ownerHash: string; publishedAt: number }
const releasePattern = /^[a-f0-9-]{36}$/;

/** A single, explicitly assigned public site; account data is never a static root. */
export class LocalSitePublisher {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, private readonly ownerId = "superadmin") {}

  canPublish(owner: string): boolean { return Boolean(this.ownerId) && owner === this.ownerId; }

  private async current(): Promise<ReleasePointer | null> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(this.directory, "current.json"), "utf8")) as ReleasePointer;
      if (value.version !== 1 || !releasePattern.test(value.releaseId) || !/^[a-f0-9]{64}$/.test(value.ownerHash) || !Number.isSafeInteger(value.publishedAt)) {
        throw new Error("Invalid local website release pointer");
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async publish(owner: string, entries: SiteZipEntry[], signal: AbortSignal): Promise<void> {
    if (!this.canPublish(owner)) throw new Error("This account cannot update the deployment website");
    const operation = this.queue.then(() => this.activate(owner, entries, signal));
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async activate(owner: string, entries: SiteZipEntry[], signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const ownerHash = createHash("sha256").update(owner).digest("hex");
    const previous = await this.current();
    if (previous && previous.ownerHash !== ownerHash) throw new Error("The local website belongs to another account");
    const files = new Map<string, Buffer>();
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.path.startsWith(OUTPUT_PREFIX)) continue;
      const name = entry.path.slice(OUTPUT_PREFIX.length);
      if (name === ".nojekyll") continue;
      if (!name || name.length > 1024 || name.includes("\\") || name.includes("\0") || name.startsWith("/") ||
        name.split("/").some((part) => !part || part.startsWith(".")) || files.has(name)) {
        throw new Error("Invalid local website output path");
      }
      bytes += entry.data.length;
      if (files.size >= 10_000 || bytes > 80 * 1024 * 1024) throw new Error("Local website output exceeds its limit");
      files.set(name, entry.data);
    }
    if (!files.has("index.html")) throw new Error("Local website has no homepage");
    const releases = path.join(this.directory, "releases");
    await fs.mkdir(releases, { recursive: true, mode: 0o700 });
    const releaseId = randomUUID();
    const staging = path.join(releases, releaseId);
    const temporary = path.join(this.directory, `current-${randomUUID()}.tmp`);
    let activated = false;
    const directories = new Set([staging, releases]);
    try {
      await fs.mkdir(staging, { mode: 0o700 });
      for (const [name, data] of files) {
        signal.throwIfAborted();
        const filename = path.join(staging, name);
        await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        for (let parent = path.dirname(filename); parent !== releases; parent = path.dirname(parent)) directories.add(parent);
        const handle = await fs.open(filename, "wx", 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      }
      for (const name of [...directories].sort((a, b) => b.length - a.length)) {
        const directory = await fs.open(name, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      }
      signal.throwIfAborted();
      const pointer: ReleasePointer = { version: 1, releaseId, ownerHash, publishedAt: Date.now() };
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(pointer)); await handle.sync(); } finally { await handle.close(); }
      signal.throwIfAborted();
      await fs.rename(temporary, path.join(this.directory, "current.json"));
      activated = true;
      // Activation has committed. Retention errors must not misreport a live
      // release as failed, or suggest that the previous website is still active.
      try {
        const directory = await fs.open(this.directory, "r");
        try { await directory.sync(); } finally { await directory.close(); }
        const keep = new Set([releaseId, previous?.releaseId]);
        for (const name of await fs.readdir(releases)) {
          if (releasePattern.test(name) && !keep.has(name)) await fs.rm(path.join(releases, name), { recursive: true, force: true });
        }
      } catch { console.warn("Local website activated; release retention could not finish."); }
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
      if (!activated) await fs.rm(staging, { recursive: true, force: true });
    }
  }

  router(): Router {
    const router = Router();
    router.use(async (request, response, next) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD"); response.sendStatus(405); return;
      }
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "no-cache");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
      try {
        const release = await this.current();
        if (!release) { response.status(404).send("Website has not been published yet."); return; }
        express.static(path.join(this.directory, "releases", release.releaseId), {
          dotfiles: "deny", fallthrough: false, index: "index.html", redirect: true,
        })(request, response, next);
      } catch { response.status(503).send("Website is temporarily unavailable."); }
    });
    router.use((error: { status?: number }, _request: express.Request, response: express.Response, next: express.NextFunction) => {
      if (response.headersSent) { next(error); return; }
      response.status(error.status === 404 || error.status === 403 ? 404 : 503).send(error.status === 404 || error.status === 403 ? "Not found." : "Website is temporarily unavailable.");
    });
    return router;
  }
}
