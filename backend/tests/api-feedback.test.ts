import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";
import {
  createQiniuSdkConfig,
  parseQiniuUploadTimeoutMs,
  QiniuConfigurationError,
  QiniuUploadError,
  uploadImageBufferToQiniu,
  type QiniuConfig,
} from "../../server/qiniu.js";

interface ImportedImage {
  hash: string;
  extension: string;
  path: string;
  url: string;
}

interface WechatPreparation {
  anonymousQuota: {
    dateKey: string;
    limit: number;
    remaining: number;
    resetsAt: string;
    used: number;
  } | null;
  html: string;
  markdown: string;
  imageCount: number;
  uploadedImageCount: number;
  reusedImageCount: number;
  theme: "default" | "smartisan-dark" | "apple-notes" | "apple-notes-light" | "bear" | "bazhahei" | "telegraph";
}

function createFeedbackQiniuConfig(uploadUrls: string[] = []): QiniuConfig {
  return {
    accessKey: "feedback-access-key",
    secretKey: "feedback-secret-key",
    bucket: "feedback-bucket",
    domain: "https://cdn.example.test",
    prefix: "feedback",
    uploadTimeoutMs: 10_000,
    uploadUrls,
  };
}

function getShanghaiDateKey(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (
    offset + 30 <= buffer.length &&
    buffer.readUInt32LE(offset) === 0x04034b50
  ) {
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedLength = buffer.readUInt32LE(offset + 18);
    const filenameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const filenameStart = offset + 30;
    const dataStart = filenameStart + filenameLength + extraLength;
    const filename = buffer
      .subarray(filenameStart, filenameStart + filenameLength)
      .toString("utf8");
    const compressed = buffer.subarray(dataStart, dataStart + compressedLength);

    entries.set(
      filename,
      compressionMethod === 8 ? inflateRawSync(compressed) : compressed,
    );
    offset = dataStart + compressedLength;
  }

  return entries;
}

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");

  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配 feedback 测试端口");
  }

  const port = address.port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`后端在健康检查前退出，退出码：${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // 服务仍在启动，继续轮询。
    }

    await delay(100);
  }

  throw new Error("等待后端健康检查超时");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    once(child, "exit"),
    delay(5_000, undefined, { ref: false }).then(() => {
      if (child.exitCode == null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

test("Express 提供健康检查和内容寻址图片存储", async (context) => {
  assert.match(
    await readFile("server/qiniu.ts", "utf8"),
    /qiniu\.conf\.RPC_TIMEOUT\s*=\s*config\.uploadTimeoutMs/,
  );

  const port = await getUnusedPort();
  const storageDir = await mkdtemp(path.join(tmpdir(), "notes-feedback-images-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-feedback-data-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  let qiniuUploadAttemptCount = 0;
  let qiniuUploadCount = 0;
  const qiniuUploadBodies: string[] = [];
  const qiniuEndpointAttempts = [0, 0, 0];
  const qiniuUploadServers = qiniuEndpointAttempts.map((_, endpointIndex) =>
    createHttpServer((request, response) => {
      qiniuUploadAttemptCount += 1;
      qiniuEndpointAttempts[endpointIndex] += 1;

      if (endpointIndex < 2) {
        request.socket.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      request.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      request.on("end", () => {
        qiniuUploadCount += 1;
        qiniuUploadBodies.push(Buffer.concat(chunks).toString("latin1"));
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"hash":"feedback","key":"feedback.png"}');
      });
    }),
  );
  const qiniuUploadUrls: string[] = [];

  for (const server of qiniuUploadServers) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("无法分配七牛 mock 上传端口");
    }

    qiniuUploadUrls.push(`http://127.0.0.1:${address.port}`);
  }

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EXPORT_APP_URL: baseUrl,
        DATA_STORAGE_DIR: dataDir,
        IMAGE_STORAGE_DIR: storageDir,
        PORT: String(port),
        QINIU_ACCESS_KEY: "feedback-access-key",
        QINIU_SECRET_KEY: "feedback-secret-key",
        QINIU_BUCKET: "feedback-bucket",
        QINIU_DOMAIN: "https://cdn.example.test",
        QINIU_PREFIX: "wechat-test",
        QINIU_UPLOAD_TIMEOUT_MS: "30000",
        QINIU_UPLOAD_URLS: qiniuUploadUrls.join(","),
        SESSION_SECRET: "wechat-feedback-session-secret",
        SUPERADMIN: "wechat-feedback-admin",
        SUPERADMINPASSWORD: "wechat-feedback-password",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  context.after(async () => {
    await stopChild(child);
    await Promise.all(
      qiniuUploadServers.map(async (server) => {
        server.close();
        await once(server, "close");
      }),
    );
    await rm(storageDir, { force: true, recursive: true });
    await rm(dataDir, { force: true, recursive: true });
  });

  try {
    await waitForHealth(baseUrl, child);

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { ok: true });

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
      "base64",
    );
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(png)], { type: "image/png" }), "pixel.png");

    const importResponse = await fetch(`${baseUrl}/api/images/import`, {
      method: "POST",
      body: form,
    });
    assert.equal(importResponse.status, 200);

    const imported = (await importResponse.json()) as ImportedImage;
    assert.match(imported.hash, /^[a-f0-9]{64}$/);
    assert.equal(imported.extension, "png");
    assert.equal(imported.path, `/images/${imported.hash}.png`);
    assert.equal(imported.url, `${baseUrl}${imported.path}`);

    const stored = await readFile(path.join(storageDir, `${imported.hash}.png`));
    assert.deepEqual(stored, png);

    const imageResponse = await fetch(`${baseUrl}${imported.path}`);
    assert.equal(imageResponse.status, 200);
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);

    const themedArchiveResponse = await fetch(`${baseUrl}/api/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "# Apple 归档\n\n正文",
        theme: "apple-notes",
      }),
    });
    assert.equal(themedArchiveResponse.status, 200);
    assert.equal(
      themedArchiveResponse.headers.get("X-Archive-Theme"),
      "apple-notes",
    );
    const themedArchiveEntries = readZipEntries(
      Buffer.from(await themedArchiveResponse.arrayBuffer()),
    );
    const themedArchiveHtmlEntry = Array.from(themedArchiveEntries.entries())
      .find(([filename]) => filename.endsWith("/index.html"));
    assert.ok(themedArchiveHtmlEntry);
    const themedArchiveHtml = themedArchiveHtmlEntry[1].toString("utf8");
    assert.match(
      themedArchiveHtml,
      /<body data-note-card-theme="apple-notes">/,
    );
    assert.match(themedArchiveHtml, /--paper: #181818;/);
    assert.match(themedArchiveHtml, /--note-link: #ebb800;/);
    assert.match(
      themedArchiveHtml,
      /body\[data-note-card-theme\^="apple-notes"\] \.note-apple-toolbar/,
    );
    assert.match(
      themedArchiveHtml,
      /body\[data-note-card-theme\^="apple-notes"\] \.sheet-inner \{\s*padding-right: 0;\s*padding-left: 0;\s*\}\s*body\[data-note-card-theme\^="apple-notes"\] \.note-sheet \{\s*padding-right: calc\(12px \* var\(--note-scale\)\);\s*padding-left: calc\(12px \* var\(--note-scale\)\);/,
    );
    assert.match(themedArchiveHtml, /class="note-apple-toolbar"/);

    const bearArchiveResponse = await fetch(`${baseUrl}/api/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "正文一与**重点文字**\n\n> Bear 引用\n\n正文二\n\n## Bear 分节\n\n正文三",
        theme: "bear",
      }),
    });
    assert.equal(bearArchiveResponse.status, 200);
    assert.equal(bearArchiveResponse.headers.get("X-Archive-Theme"), "bear");
    const bearArchiveEntries = readZipEntries(
      Buffer.from(await bearArchiveResponse.arrayBuffer()),
    );
    const bearArchiveHtmlEntry = Array.from(bearArchiveEntries.entries())
      .find(([filename]) => filename.endsWith("/index.html"));
    assert.ok(bearArchiveHtmlEntry);
    const bearArchiveHtml = bearArchiveHtmlEntry[1].toString("utf8");
    assert.match(bearArchiveHtml, /<body data-note-card-theme="bear">/);
    assert.match(
      bearArchiveHtml,
      /--bear-block-gap: max\(calc\(0\.33rem \* var\(--note-scale\)\), 8\.448px\);/,
    );
    assert.match(
      bearArchiveHtml,
      /font-size: max\(calc\(0\.46875rem \* var\(--note-scale\)\), 12px\);/,
    );
    assert.match(
      bearArchiveHtml,
      /\.note-copy \.markdown-blank-line \{\s*height: var\(--bear-block-gap\);/,
    );
    assert.match(
      bearArchiveHtml,
      /body\[data-note-card-theme="bear"\] \.note-copy strong \{\s*color: var\(--note-link\);\s*font-weight: 700;/,
    );
    assert.match(
      bearArchiveHtml,
      /body\[data-note-card-theme="bear"\] \.note-copy blockquote::before \{[\s\S]*?left: 0;/,
    );
    assert.match(bearArchiveHtml, /<strong>重点文字<\/strong>/);
    assert.doesNotMatch(bearArchiveHtml, /data-note-apple-toolbar="true"/);

    const bazhaheiArchiveResponse = await fetch(`${baseUrl}/api/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "# 杂志标题\n\n## 核心判断\n\n> 摘要卡片\n\n正文",
        theme: "bazhahei",
      }),
    });
    assert.equal(bazhaheiArchiveResponse.status, 200);
    assert.equal(
      bazhaheiArchiveResponse.headers.get("X-Archive-Theme"),
      "bazhahei",
    );
    const bazhaheiArchiveEntries = readZipEntries(
      Buffer.from(await bazhaheiArchiveResponse.arrayBuffer()),
    );
    const bazhaheiArchiveHtmlEntry = Array.from(
      bazhaheiArchiveEntries.entries(),
    ).find(([filename]) => filename.endsWith("/index.html"));
    assert.ok(bazhaheiArchiveHtmlEntry);
    const bazhaheiArchiveHtml = bazhaheiArchiveHtmlEntry[1].toString("utf8");
    assert.match(
      bazhaheiArchiveHtml,
      /<body data-note-card-theme="bazhahei">/,
    );
    assert.match(
      bazhaheiArchiveHtml,
      /--bazhahei-accent: #d4734b;/,
    );
    assert.match(
      bazhaheiArchiveHtml,
      /background: var\(--bazhahei-surface\);/,
    );
    assert.match(
      bazhaheiArchiveHtml,
      /\.note-index h2::before \{\s*content: "■";/,
    );
    const bazhaheiArchiveHasBundledFonts = Array.from(
      bazhaheiArchiveEntries.keys(),
    ).some((filename) => filename.endsWith("OPPOSans-R-subset.woff2"));
    const bazhaheiArchiveFontPrefix = bazhaheiArchiveHasBundledFonts
      ? '"OPPOSansArchive", '
      : "";
    assert.match(
      bazhaheiArchiveHtml,
      new RegExp(
        `--note-font: ${bazhaheiArchiveFontPrefix}"OPPOSans","Noto Sans SC"`,
      ),
    );
    assert.match(
      bazhaheiArchiveHtml,
      new RegExp(
        `--note-heading-font: ${bazhaheiArchiveFontPrefix}"OPPOSans","Noto Sans SC"`,
      ),
    );

    const telegraphArchiveResponse = await fetch(`${baseUrl}/api/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "# Telegraph 标题\n\n正文\n\n> 引用",
        theme: "telegraph",
      }),
    });
    assert.equal(telegraphArchiveResponse.status, 200);
    assert.equal(
      telegraphArchiveResponse.headers.get("X-Archive-Theme"),
      "telegraph",
    );
    const telegraphArchiveEntries = readZipEntries(
      Buffer.from(await telegraphArchiveResponse.arrayBuffer()),
    );
    const telegraphArchiveHtmlEntry = Array.from(
      telegraphArchiveEntries.entries(),
    ).find(([filename]) => filename.endsWith("/index.html"));
    assert.ok(telegraphArchiveHtmlEntry);
    const telegraphArchiveHtml = telegraphArchiveHtmlEntry[1].toString("utf8");
    assert.match(
      telegraphArchiveHtml,
      /<body data-note-card-theme="telegraph">/,
    );
    assert.match(
      telegraphArchiveHtml,
      /--telegraph-block-gap: max\(calc\(0\.375rem \* var\(--note-scale\)\), 10\.5px\);/,
    );
    assert.match(
      telegraphArchiveHtml,
      /font-size: max\(calc\(0\.5625rem \* var\(--note-scale\)\), 16px\);/,
    );
    assert.match(
      telegraphArchiveHtml,
      /margin:\s*calc\(9px \* var\(--note-scale\)\)\s*calc\(10\.5px \* var\(--note-scale\)\)\s*calc\(8px \* var\(--note-scale\)\)\s*calc\(3px \* var\(--note-scale\)\);/,
    );
    assert.match(
      telegraphArchiveHtml,
      /border-left: calc\(1\.5px \* var\(--note-scale\)\) solid #000000;/,
    );
    assert.doesNotMatch(
      telegraphArchiveHtml,
      /data-note-apple-toolbar="true"/,
    );

    const invalidArchiveThemeResponse = await fetch(`${baseUrl}/api/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: "无效归档主题", theme: "unknown-theme" }),
    });
    assert.equal(invalidArchiveThemeResponse.status, 400);

    const publicImageBaseUrl = "https://notes.example.invalid";
    const wechatResponse = await fetch(`${baseUrl}/api/wechat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Host": "notes.example.invalid",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        footerBrand: "由 API 自定义发送",
        footerLogoUrl: imported.path,
        footerVia: "via API Feedback",
        theme: "default",
        markdown: [
          "[公众号测试]",
          "",
          "这是 **加粗正文**。",
          "",
          "9. **鼓励**vibe coding",
          `![像素图](${publicImageBaseUrl}${imported.path})`,
          "10. 图片后的编号仍可见",
          "",
          "相同内容的第二个地址：",
          `![相同内容的第二个地址](${publicImageBaseUrl}${imported.path}?duplicate=1)`,
        ].join("\n"),
      }),
    });
    assert.equal(wechatResponse.status, 200);

    const wechat = (await wechatResponse.json()) as WechatPreparation;
    const temporaryPrefix = `wechat-test/temporary/${getShanghaiDateKey()}`;
    const qiniuImageUrl =
      `https://cdn.example.test/${temporaryPrefix}/${imported.hash}.png`;
    const footerHammerUrl =
      "https://notes.fangyuanxiaozhan.com/images/b5d3bd9587fa9a1226b25a0709ff61a450df29d96ca2f127c6afc0b8e193a60e.png";

    assert.equal(wechat.imageCount, 2);
    assert.equal(wechat.theme, "default");
    assert.equal(wechat.uploadedImageCount, 1);
    assert.equal(wechat.reusedImageCount, 2);
    assert.equal(wechat.anonymousQuota?.limit, 500);
    assert.equal(wechat.anonymousQuota?.used, 1);
    assert.equal(wechat.anonymousQuota?.remaining, 499);
    assert.equal(qiniuUploadAttemptCount, 3);
    assert.deepEqual(qiniuEndpointAttempts, [1, 1, 1]);
    assert.equal(qiniuUploadCount, 1);
    assert.equal(
      (
        wechat.markdown.match(
          new RegExp(qiniuImageUrl.replace(/\./g, "\\."), "g"),
        ) ?? []
      ).length,
      2,
    );
    assert.equal(qiniuUploadBodies.length, 1);
    assert.match(
      qiniuUploadBodies[0],
      new RegExp(`${temporaryPrefix}/${imported.hash}\\.png`),
    );
    assert.match(
      qiniuUploadBodies[0],
      new RegExp(`filename="${imported.hash}\\.png"`),
    );
    const uploadTokenMatch =
      /name="token"\r\n\r\n([^\r\n]+)/.exec(qiniuUploadBodies[0]);
    assert.ok(uploadTokenMatch);
    const uploadPolicy = JSON.parse(
      Buffer.from(uploadTokenMatch[1].split(":")[2], "base64url").toString(
        "utf8",
      ),
    ) as { deleteAfterDays?: number };
    assert.equal(uploadPolicy.deleteAfterDays, 1);
    assert.match(wechat.html, /data-tool="开源版锤子便签"/);
    assert.match(wechat.html, /data-note-card-theme="default"/);
    assert.match(wechat.html, /data-smartisan-theme="default"/);
    assert.match(
      wechat.html,
      /data-smartisan-theme="default" style="[^"]*padding:0[^"]*background-color:transparent/,
    );
    assert.match(wechat.html, /data-smartisan-paper="true"/);
    assert.match(
      wechat.html,
      /data-smartisan-paper="true" style="[^"]*padding-bottom:12%[^"]*border:0[^"]*background-color:#fffcf7/,
    );
    assert.doesNotMatch(
      wechat.html,
      /background-color:rgba\(239,230,216,0\.95\)/,
    );
    assert.equal(
      (wechat.html.match(/data-smartisan-corner=/g) ?? []).length,
      4,
    );
    assert.match(wechat.html, /<table data-smartisan-frame="outer"/);
    assert.match(
      wechat.html,
      /<table data-smartisan-frame="outer"[^>]*style="[^"]*border:0/,
    );
    assert.match(
      wechat.html,
      /<col width="6" style="width:6px"\/><col\/><col width="6"/,
    );
    assert.doesNotMatch(
      wechat.html,
      /data-smartisan-corner="[^"]+"[^>]*(?:rowSpan|colSpan)=/,
    );
    assert.equal(
      (
        wechat.html.match(
          /border-bottom:1px solid #e8e4dc/g,
        ) ?? []
      ).length,
      1,
    );
    assert.equal(
      (
        wechat.html.match(
          /border-left:1px solid #e8e4dc/g,
        ) ?? []
      ).length,
      1,
    );
    assert.equal(
      (
        wechat.html.match(
          /border-right:1px solid #e8e4dc/g,
        ) ?? []
      ).length,
      1,
    );
    assert.equal(
      (
        wechat.html.match(
          /border-top:1px solid #e8e4dc/g,
        ) ?? []
      ).length,
      1,
    );
    assert.match(
      wechat.html,
      /<td style="padding:2\.8px;border:0"><section data-smartisan-frame="inner"/,
    );
    assert.doesNotMatch(
      wechat.html,
      /data-smartisan-corner="[^"]+"[^>]*position:absolute/,
    );
    assert.doesNotMatch(wechat.html, /<header[^>]*text-align:center/);
    assert.match(
      wechat.html,
      /<p style="margin:0;line-height:1\.75;text-align:center">公众号测试<\/p>/,
    );
    assert.match(
      wechat.html,
      /<p style="margin:0;line-height:1\.75">这是 <strong/,
    );
    assert.match(
      wechat.html,
      /data-smartisan-theme="default" style="[^"]*color:#665749[^"]*font-size:15px[^"]*line-height:1\.75[^"]*white-space:pre-wrap/,
    );
    assert.match(
      wechat.html,
      /<strong[^>]*font-weight:600[^>]*>加粗正文<\/strong>/,
    );
    assert.doesNotMatch(wechat.html, /-webkit-text-stroke/);
    assert.match(
      wechat.html,
      /<strong[^>]*>鼓励\u2060<\/strong>vibe coding/,
    );
    assert.doesNotMatch(
      wechat.html,
      /<\/strong>[\u00a0\u2060]vibe coding/,
    );
    assert.match(wechat.html, /<ol start="9"/);
    assert.match(wechat.html, /<ol start="10"/);
    assert.match(wechat.html, /图片后的编号仍可见<\/li>/);
    assert.match(wechat.html, /data-smartisan-image="true"/);
    assert.match(wechat.html, /data-smartisan-image-frame="android"/);
    assert.match(wechat.html, /padding:4\.2px/);
    assert.match(wechat.html, /border:1px solid #ebe8e3/);
    assert.match(wechat.html, /background-color:#ffffff/);
    assert.match(
      wechat.html,
      /box-shadow:0 1\.4px 4\.2px rgba\(88,70,52,0\.07\)/,
    );
    assert.match(wechat.html, /<img[^>]*width="100%"/);
    assert.match(wechat.html, /width:100% !important/);
    assert.match(wechat.html, /max-width:100% !important/);
    assert.doesNotMatch(
      wechat.html,
      /<li\b[^>]*>(?:(?!<\/li>)[\s\S])*data-smartisan-image="true"/,
    );
    assert.match(
      wechat.html,
      /data-smartisan-image="true"[^>]*margin:16\.8px auto 2\.8px/,
    );
    assert.doesNotMatch(wechat.html, /<li style="[^"]*overflow:hidden/);
    assert.match(wechat.html, new RegExp(qiniuImageUrl.replace(/\./g, "\\.")));
    assert.match(wechat.html, /由 API 自定义发送/);
    assert.match(wechat.html, /via API Feedback/);
    assert.match(
      wechat.html,
      /<section data-smartisan-footer="true" style="[^"]*margin:42px 14px 0[^"]*font-size:0[^"]*line-height:14\.336px/,
    );
    assert.doesNotMatch(wechat.html, /<footer(?:\s|>)/);
    assert.doesNotMatch(wechat.html, /<table data-smartisan-footer="true"/);
    assert.match(wechat.html, /data-smartisan-hammer="true"/);
    assert.match(
      wechat.html,
      new RegExp(
        `data-smartisan-hammer="true"[^>]*src="${qiniuImageUrl.replace(/\./g, "\\.")}"`,
      ),
    );
    assert.doesNotMatch(
      wechat.html,
      new RegExp(footerHammerUrl.replace(/\./g, "\\.")),
    );
    assert.match(
      wechat.html,
      /data-smartisan-hammer="true"[^>]*border-radius:50%;background-color:transparent;object-fit:contain/,
    );
    assert.doesNotMatch(wechat.html, /src="data:/);
    assert.doesNotMatch(wechat.html, /<link\b[^>]*rel="preload"/);

    const bearWechatResponse = await fetch(`${baseUrl}/api/wechat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "> Bear 引用\n\nBear **重点文字**与[链接](https://example.com)",
        theme: "bear",
      }),
    });
    assert.equal(bearWechatResponse.status, 200);
    const bearWechat = (await bearWechatResponse.json()) as WechatPreparation;
    assert.equal(bearWechat.theme, "bear");
    assert.match(bearWechat.html, /data-note-card-theme="bear"/);
    assert.match(bearWechat.html, /background-color:#ffffff/);
    assert.match(bearWechat.html, /color:#dd4c4f/);
    assert.match(bearWechat.html, />▎<\/span>Bear 引用/);
    assert.match(
      bearWechat.html,
      /<strong style="[^"]*color:#dd4c4f;[^"]*font-weight:700[^"]*">重点文字<\/strong>/,
    );
    assert.doesNotMatch(bearWechat.html, /data-note-apple-toolbar="true"/);

    const bazhaheiWechatResponse = await fetch(`${baseUrl}/api/wechat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "# 杂志标题\n\n## 核心判断\n\n> 摘要卡片\n\n正文与**重点**",
        theme: "bazhahei",
      }),
    });
    assert.equal(bazhaheiWechatResponse.status, 200);
    const bazhaheiWechat =
      (await bazhaheiWechatResponse.json()) as WechatPreparation;
    assert.equal(bazhaheiWechat.theme, "bazhahei");
    assert.match(bazhaheiWechat.html, /data-note-card-theme="bazhahei"/);
    assert.match(bazhaheiWechat.html, /background-color:#faf9f5/);
    assert.match(bazhaheiWechat.html, />■ <\/span>核心判断/);
    assert.match(bazhaheiWechat.html, /background:#efe9de/);
    assert.doesNotMatch(bazhaheiWechat.html, />[“▎]<\/span>摘要卡片/);

    const telegraphWechatResponse = await fetch(`${baseUrl}/api/wechat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: "# Telegraph 标题\n\n正文与[链接](https://example.com)\n\n> 引用",
        theme: "telegraph",
      }),
    });
    assert.equal(telegraphWechatResponse.status, 200);
    const telegraphWechat =
      (await telegraphWechatResponse.json()) as WechatPreparation;
    assert.equal(telegraphWechat.theme, "telegraph");
    assert.match(telegraphWechat.html, /data-note-card-theme="telegraph"/);
    assert.match(telegraphWechat.html, /font-size:18px/);
    assert.match(telegraphWechat.html, /line-height:1\.58/);
    assert.match(telegraphWechat.html, /height:0\.667em/);
    assert.match(telegraphWechat.html, /border-left:3px solid #000000/);
    assert.doesNotMatch(
      telegraphWechat.html,
      /data-note-apple-toolbar="true"/,
    );

    const invalidWechatThemeResponse = await fetch(`${baseUrl}/api/wechat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: "无效主题", theme: "unknown-theme" }),
    });
    assert.equal(invalidWechatThemeResponse.status, 400);

    const adminLoginResponse = await fetch(
      `${baseUrl}/api/superadmin/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "wechat-feedback-password",
          remember: false,
          username: "wechat-feedback-admin",
        }),
      },
    );
    const adminCookie =
      adminLoginResponse.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(adminCookie);

    const adminWechatResponse = await fetch(`${baseUrl}/api/wechat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        markdown: `![管理员图片](${baseUrl}${imported.path})`,
      }),
    });
    assert.equal(adminWechatResponse.status, 200);
    const adminWechat =
      (await adminWechatResponse.json()) as WechatPreparation;
    assert.equal(adminWechat.anonymousQuota, null);
    assert.equal(qiniuUploadCount, 2);
    assert.doesNotMatch(qiniuUploadBodies[1], /temporary/);

    const accountResponse = await fetch(`${baseUrl}/api/superadmin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ username: "wechat-registered-user" }),
    });
    assert.equal(accountResponse.status, 201);
    const createdAccount = (await accountResponse.json()) as {
      user: { initialPassword: string; username: string };
    };

    const userLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: createdAccount.user.initialPassword,
        remember: false,
        username: createdAccount.user.username,
      }),
    });
    const userCookie =
      userLoginResponse.headers.get("set-cookie")?.split(";")[0] || "";
    assert.ok(userCookie);

    const registeredWechatResponse = await fetch(`${baseUrl}/api/wechat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: userCookie,
      },
      body: JSON.stringify({
        markdown: `![注册用户图片](${baseUrl}${imported.path})`,
      }),
    });
    assert.equal(registeredWechatResponse.status, 200);
    const registeredWechat =
      (await registeredWechatResponse.json()) as WechatPreparation;
    assert.equal(registeredWechat.anonymousQuota, null);
    assert.equal(qiniuUploadCount, 3);
    assert.match(
      registeredWechat.markdown,
      new RegExp(
        `https://cdn\\.example\\.test/wechat-test/${imported.hash}\\.png`,
      ),
    );
    assert.doesNotMatch(qiniuUploadBodies[2], /temporary/);
    const registeredTokenMatch =
      /name="token"\r\n\r\n([^\r\n]+)/.exec(qiniuUploadBodies[2]);
    assert.ok(registeredTokenMatch);
    const registeredPolicy = JSON.parse(
      Buffer.from(
        registeredTokenMatch[1].split(":")[2],
        "base64url",
      ).toString("utf8"),
    ) as { deleteAfterDays?: number };
    assert.equal(registeredPolicy.deleteAfterDays, undefined);
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
});

test("七牛上传为完整 TLS 和请求链路保留可配置超时预算", () => {
  assert.equal(parseQiniuUploadTimeoutMs(), 30_000);
  assert.equal(parseQiniuUploadTimeoutMs("45000"), 45_000);
  assert.throws(
    () => parseQiniuUploadTimeoutMs("6000"),
    QiniuConfigurationError,
  );
  assert.throws(
    () => parseQiniuUploadTimeoutMs("not-a-number"),
    QiniuConfigurationError,
  );
});

test("七牛 SDK 默认自动发现区域，旧标准域名只作为首选并补齐备用节点", async () => {
  const automatic = createQiniuSdkConfig(createFeedbackQiniuConfig());

  assert.equal(automatic.useHttpsDomain, true);
  assert.equal(automatic.regionsProvider, null);

  const compatible = createQiniuSdkConfig(
    createFeedbackQiniuConfig(["https://upload-z2.qiniup.com"]),
  );
  const regions = await compatible.regionsProvider?.getRegions();
  const uploadHosts =
    regions?.[0].services.up.map((endpoint) => endpoint.host) ??
    [];

  assert.deepEqual(uploadHosts.slice(0, 3), [
    "upload-z2.qiniup.com",
    "up-z2.qiniup.com",
    "up-z2.qbox.me",
  ]);
});

test("七牛 SDK 耗尽所有上传节点时保留底层网络错误", async (context) => {
  const attempts = [0, 0, 0];
  const servers = attempts.map((_, endpointIndex) =>
    createHttpServer((request) => {
      attempts[endpointIndex] += 1;
      request.socket.destroy();
    }),
  );
  const uploadUrls: string[] = [];

  for (const server of servers) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("无法分配七牛失败链路 mock 端口");
    }

    uploadUrls.push(`http://127.0.0.1:${address.port}`);
  }

  context.after(async () => {
    await Promise.all(
      servers.map(async (server) => {
        server.close();
        await once(server, "close");
      }),
    );
  });

  await assert.rejects(
    uploadImageBufferToQiniu(
      Buffer.from("qiniu-feedback"),
      "png",
      createFeedbackQiniuConfig(uploadUrls),
    ),
    (error: unknown) => {
      assert.ok(error instanceof QiniuUploadError);
      assert.match(error.message, /已尝试区域查询和上传链路中的所有可用节点/);
      assert.ok(error.cause instanceof Error);
      assert.equal(error.code, "ECONNRESET");
      return true;
    },
  );
  assert.deepEqual(attempts, [1, 1, 1]);
});
