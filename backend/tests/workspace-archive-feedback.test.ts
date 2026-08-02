import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { inflateRawSync } from "node:zlib";

interface WorkspaceArchiveJob {
  id: string;
  status: "preparing" | "collecting" | "packaging" | "ready" | "failed";
  progress: number;
  message: string;
  completedNotes: number;
  totalNotes: number;
  error?: string;
}

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
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
      // 服务仍在启动。
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

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
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
    const data = compressionMethod === 8 ? inflateRawSync(compressed) : compressed;

    entries.set(filename, data);
    offset = dataStart + compressedLength;
  }

  return entries;
}

test("整体导出保留目录、Markdown、相关图片和真实任务进度", async (context) => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
    "base64",
  );
  const imageServer = createHttpServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
      });
      response.end(png);
    }, 250);
  });
  imageServer.listen(0, "127.0.0.1");
  await once(imageServer, "listening");
  const imageAddress = imageServer.address();

  if (!imageAddress || typeof imageAddress === "string") {
    throw new Error("无法分配图片测试端口");
  }

  const port = await getUnusedPort();
  const storageDir = await mkdtemp(path.join(tmpdir(), "notes-workspace-export-images-"));
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-workspace-export-data-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_STORAGE_DIR: dataDir,
      IMAGE_STORAGE_DIR: storageDir,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  context.after(async () => {
    await stopChild(child);
    imageServer.close();
    await once(imageServer, "close");
    await rm(storageDir, { force: true, recursive: true });
    await rm(dataDir, { force: true, recursive: true });
  });

  try {
    await waitForHealth(baseUrl, child);
    const now = Date.now();
    const imageUrl = `http://127.0.0.1:${imageAddress.port}/pixel.png`;
    const workspace = {
      version: 1,
      activeNoteId: "note-project-1",
      folders: [
        { id: "folder-work", name: "工作/计划", createdAt: now },
        { id: "folder-empty", name: "空文件夹", createdAt: now + 1 },
      ],
      notes: [
        {
          id: "note-project-1",
          markdown: [
            "## 项目计划",
            "",
            `![像素图](${imageUrl})`,
            `![查询参数变体](${imageUrl}?variant=1)`,
          ].join("\n"),
          createdAt: now,
          updatedAt: now,
          normalOrder: 0,
          pinnedAt: null,
          folderId: "folder-work",
          isStarred: false,
          deletedAt: null,
        },
        {
          id: "note-project-2",
          markdown: "## 项目计划\n\n重复标题也不能覆盖。",
          createdAt: now + 1,
          updatedAt: now + 1,
          normalOrder: 1,
          pinnedAt: null,
          folderId: "folder-work",
          isStarred: true,
          deletedAt: null,
        },
        {
          id: "note-unfiled",
          markdown: "随手记\n\n未分类正文。",
          createdAt: now + 2,
          updatedAt: now + 2,
          normalOrder: 2,
          pinnedAt: null,
          folderId: null,
          isStarred: false,
          deletedAt: null,
        },
        {
          id: "note-trash",
          markdown: "旧便签\n\n仍可恢复的正文。",
          createdAt: now + 3,
          updatedAt: now + 3,
          normalOrder: 3,
          pinnedAt: null,
          folderId: "folder-work",
          isStarred: false,
          deletedAt: now + 4,
        },
      ],
    };
    const createResponse = await fetch(`${baseUrl}/api/workspace/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    });
    assert.equal(createResponse.status, 202);
    let job = (await createResponse.json()) as WorkspaceArchiveJob;
    assert.equal(job.status, "preparing");
    assert.equal(job.totalNotes, 4);

    const seenStatuses = new Set<WorkspaceArchiveJob["status"]>([job.status]);
    const deadline = Date.now() + 10_000;

    while (job.status !== "ready" && Date.now() < deadline) {
      await delay(20);
      const statusResponse = await fetch(
        `${baseUrl}/api/workspace/archive/${job.id}`,
      );
      assert.equal(statusResponse.status, 200);
      job = (await statusResponse.json()) as WorkspaceArchiveJob;
      seenStatuses.add(job.status);

      if (job.status === "failed") {
        throw new Error(job.error || job.message);
      }
    }

    assert.equal(job.status, "ready");
    assert.equal(job.progress, 95);
    assert.equal(job.completedNotes, 4);
    assert.ok(seenStatuses.has("collecting"));
    const downloadResponse = await fetch(
      `${baseUrl}/api/workspace/archive/${job.id}/download`,
    );
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get("content-type"), "application/zip");
    assert.match(
      downloadResponse.headers.get("content-disposition") || "",
      /smartisan-notes-\d{4}-\d{2}-\d{2}/,
    );
    const entries = readZipEntries(
      Buffer.from(await downloadResponse.arrayBuffer()),
    );
    const readmePath = Array.from(entries.keys()).find((entry) =>
      entry.endsWith("/导出说明.md"),
    );
    assert.ok(readmePath);
    const rootFolder = readmePath.slice(0, -"/导出说明.md".length);
    const projectMarkdownPath = `${rootFolder}/工作-计划/项目计划.md`;

    assert.ok(entries.has(`${rootFolder}/工作-计划/`));
    assert.ok(entries.has(`${rootFolder}/空文件夹/`));
    assert.ok(entries.has(`${rootFolder}/_未分类/随手记.md`));
    assert.ok(entries.has(`${rootFolder}/_回收站/旧便签.md`));
    assert.ok(entries.has(`${rootFolder}/工作-计划/项目计划-2.md`));
    assert.ok(entries.has(`${rootFolder}/工作-计划/项目计划.assets/pixel.png`));
    assert.ok(entries.has(`${rootFolder}/工作-计划/项目计划.assets/pixel-2.png`));
    assert.match(entries.get(readmePath)?.toString("utf8") || "", /便签总数：4/);
    assert.equal(
      entries.get(projectMarkdownPath)?.toString("utf8"),
      [
        "## 项目计划",
        "",
        "![像素图](项目计划.assets/pixel.png)",
        "![查询参数变体](项目计划.assets/pixel-2.png)",
      ].join("\n"),
    );
    assert.deepEqual(
      entries.get(`${rootFolder}/工作-计划/项目计划.assets/pixel.png`),
      png,
    );
    assert.deepEqual(
      entries.get(`${rootFolder}/工作-计划/项目计划.assets/pixel-2.png`),
      png,
    );
    const releasedJobResponse = await fetch(
      `${baseUrl}/api/workspace/archive/${job.id}`,
    );
    assert.equal(releasedJobResponse.status, 404);

    const invalidResponse = await fetch(`${baseUrl}/api/workspace/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: { version: 1, notes: [] } }),
    });
    assert.equal(invalidResponse.status, 400);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${stderr ? `\nstderr:\n${stderr}` : ""}`,
    );
  }
});
