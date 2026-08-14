// 端到端 feedback：启动真实后端（临时存储目录 + 随机端口 + 临时超级管理员），
// 验证两种分级模式：
//   1. 配置了服务：用 NotesClient 走完 申请 token → 导出对话写入便签 → 更新便签。
//   2. 未配置：匿名导出接口把对话渲染成锤子便签 PNG，并落盘为本地文件。
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  NotesClient,
  resolveDemoServer,
  savePngToTempFile,
} from "../src/notes-client.js";
import type { NoteWorkspace } from "../src/types.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配插件 feedback 测试端口");
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
      throw new Error(`后端在插件测试前退出，退出码：${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }
    } catch {
      // 服务仍在启动。
    }

    await delay(150);
  }

  throw new Error("后端未在 30 秒内就绪。");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await once(child, "exit").catch(() => undefined);
}

test("插件客户端可把对话导出为便签并更新（真实后端 + 临时存储）", async (context) => {
  const port = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-plugin-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-plugin-images-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const superadmin = "feedback-plugin-admin";
  const superadminPassword = "feedback-plugin-admin-password";

  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATA_STORAGE_DIR: dataDir,
        IMAGE_STORAGE_DIR: imageDir,
        PORT: String(port),
        SESSION_SECRET: "feedback-plugin-session-secret-with-sufficient-entropy",
        SUPERADMIN: superadmin,
        SUPERADMINPASSWORD: superadminPassword,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";

  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  context.after(async () => {
    await stopChild(child);
    await rm(dataDir, { force: true, recursive: true });
    await rm(imageDir, { force: true, recursive: true });
  });

  try {
    await waitForHealth(baseUrl, child);

    // 首次导出：用账号密码申请 token，工作区从空开始。
    const client = new NotesClient({
      baseUrl,
      username: superadmin,
      password: superadminPassword,
    });
    const markdown = "# 对话记录\n\n**用户**：把我们的对话导出成便签\n\n**助手**：好的。";
    const created = await client.exportNote({ markdown });

    assert.equal(created.action, "created");
    const createdNoteId = created.noteId;
    assert.ok(createdNoteId, "应返回便签 ID");
    assert.match(createdNoteId, /^[0-9a-f-]{36}$/);
    assert.equal(created.title, "对话记录");
    assert.equal(created.url, `${baseUrl}/#note=${createdNoteId}&view=preview`);
    assert.equal(typeof created.updatedAt, "number");
    assert.equal(created.server, baseUrl);
    assert.equal(created.filePath, null);

    // 校验持久化：工作区里确实有这张便签。
    const token = await client.resolveToken();
    const storedResponse = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(storedResponse.status, 200);
    const stored = (await storedResponse.json()) as {
      updatedAt: number | null;
      workspace: NoteWorkspace;
    };
    assert.ok(stored.workspace);
    assert.equal(stored.workspace.notes.length, 1);
    assert.equal(stored.workspace.notes[0].id, createdNoteId);
    assert.equal(stored.workspace.notes[0].markdown, markdown);
    assert.equal(stored.workspace.notes[0].deletedAt, null);

    // 二次导出：按 note_id 更新同一张便签。
    const updatedMarkdown = "# 对话记录（更新版）\n\n已更新正文";
    const updated = await client.exportNote({
      markdown: updatedMarkdown,
      noteId: createdNoteId,
      starred: true,
    });

    assert.equal(updated.action, "updated");
    assert.equal(updated.noteId, createdNoteId);

    const storedAfter = (await (
      await fetch(`${baseUrl}/api/workspace`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { workspace: NoteWorkspace };
    assert.equal(storedAfter.workspace.notes.length, 1);
    assert.equal(storedAfter.workspace.notes[0].markdown, updatedMarkdown);
    assert.equal(storedAfter.workspace.notes[0].isStarred, true);

    // 分级模式 2：匿名导出接口无需登录即可渲染便签图片，并落盘为本地文件。
    const anonymous = new NotesClient({ baseUrl });
    const image = await anonymous.exportImage({
      markdown: "# 尝鲜对话\n\n**用户**：你好\n\n**助手**：这是匿名渲染的便签。",
      theme: "smartisan-dark",
    });
    assert.ok(image.png.length > 8, "应返回非空 PNG 字节");
    assert.deepEqual(
      Array.from(image.png.slice(0, 8)),
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "PNG 魔数应正确",
    );
    assert.ok(image.url && image.url.startsWith(`${baseUrl}/images/`), `图片 URL 应在测试服务上：${image.url}`);
    assert.equal(image.theme, "smartisan-dark");
    assert.equal(resolveDemoServer({ demoServer: baseUrl }), baseUrl);

    const imagePath = await savePngToTempFile(image.png, "尝鲜对话");
    try {
      assert.ok(imagePath.startsWith(tmpdir()));
      assert.match(imagePath, /dsh-notes-/);
      assert.deepEqual(await readFile(imagePath), Buffer.from(image.png));
    } finally {
      await rm(path.dirname(imagePath), { force: true, recursive: true });
    }

    // 数据确实落在临时存储目录而不是真实 storage。
    const dataFile = path.join(dataDir, "notes-data.json");
    const raw = await readFile(dataFile, "utf8");
    assert.match(raw, /对话记录/);
    assert.ok(!stderr.includes("ERROR"), `后端不应输出 ERROR 日志：\n${stderr}`);
  } finally {
    await stopChild(child);
    await rm(dataDir, { force: true, recursive: true });
    await rm(imageDir, { force: true, recursive: true });
  }
});
