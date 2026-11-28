import { siteBuildGate } from "./build-gate.js";
import type { Request, Response } from "express";
import { buildSiteEntries, validateSiteExportRequest, type SiteZipEntry } from "./build.js";
import { createSiteImageReader } from "./assets.js";

export function createSiteExportHandler(options: {
  rootDirectory: string;
  imagesDirectory: string;
  publicDirectory: string;
  publicOrigin: (request: Request) => string;
  getUser: (request: Request, response: Response) => Promise<{ id: string } | null>;
  isSameOrigin: (request: Request) => boolean;
  createZip: (entries: SiteZipEntry[]) => Buffer;
}) {
  const running = new Set<string>();
  return async (request: Request, response: Response): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    if (!options.isSameOrigin(request)) { response.status(403).json({ error: "请从本站打开网站发布面板。" }); return; }
    const user = await options.getUser(request, response);
    if (!user) return;
    if (running.has(user.id) || running.size >= 2) { response.status(429).json({ error: "已有网站导出正在进行，请稍后再试。" }); return; }
    let parsed;
    try { parsed = validateSiteExportRequest(request.body); } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "网站设置不正确。" }); return;
    }
    const releaseBuild = siteBuildGate.tryAcquire(user.id);
    if (!releaseBuild) { response.status(429).json({ error: "已有网站生成任务正在进行，请稍后重试。" }); return; }
    running.add(user.id);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 120_000);
    const disconnect = () => { if (!response.writableFinished) controller.abort(); };
    response.on("close", disconnect);
    try {
      const entries = await buildSiteEntries(parsed, {
        rootDirectory: options.rootDirectory, signal: controller.signal,
        readImage: createSiteImageReader({ imagesDirectory: options.imagesDirectory, publicDirectory: options.publicDirectory, publicOrigin: options.publicOrigin(request) }),
      });
      controller.signal.throwIfAborted();
      const buffer = options.createZip(entries);
      response.setHeader("Content-Type", "application/zip");
      response.setHeader("Content-Disposition", 'attachment; filename="notes-hugo-site.zip"');
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.send(buffer);
    } catch (error) {
      if (response.destroyed) return;
      response.status(controller.signal.aborted ? 504 : 422).json({ error: controller.signal.aborted ? "网站生成超时，请减少便签或图片后重试。" : error instanceof Error ? error.message : "网站生成失败，请重试。" });
    } finally {
      clearTimeout(deadline);
      response.off("close", disconnect);
      running.delete(user.id);
      releaseBuild();
    }
  };
}
