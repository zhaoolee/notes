import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { NoteWorkspace } from "../../src/types/app.js";

const execFileAsync = promisify(execFile);
const skillScript = path.resolve(
  "skills/notes-export-api/scripts/notes_api.mjs",
);

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配 Skill feedback 测试端口");
  }

  const port = address.port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`后端在 Skill 测试前退出，退出码：${child.exitCode}`);
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

  throw new Error("等待 Skill feedback 测试后端超时");
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

function getCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";")[0];
}

async function runSkill(
  baseUrl: string,
  args: string[],
): Promise<Record<string, unknown>> {
  const result = await execFileAsync(
    process.execPath,
    [
      skillScript,
      ...args,
      "--base-url",
      baseUrl,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NOTES_API_PASSWORD: "feedback-admin-password",
        NOTES_API_USERNAME: "feedback-admin",
      },
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test("便签管理 Skill 可查询、新增、分类、星标、置顶并生成公众号格式", async (context) => {
  const port = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-skill-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-skill-images-"));
  const outputDir = await mkdtemp(path.join(tmpdir(), "notes-skill-output-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_STORAGE_DIR: dataDir,
        IMAGE_STORAGE_DIR: imageDir,
        PORT: String(port),
        SESSION_SECRET: "feedback-session-secret-with-sufficient-entropy",
        SUPERADMIN: "feedback-admin",
        SUPERADMINPASSWORD: "feedback-admin-password",
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
    await rm(dataDir, { force: true, recursive: true });
    await rm(imageDir, { force: true, recursive: true });
    await rm(outputDir, { force: true, recursive: true });
  });

  try {
    await waitForHealth(baseUrl, child);

    const emptyList = await runSkill(baseUrl, ["list"]);
    assert.equal(emptyList.total, 0);
    assert.deepEqual(emptyList.notes, []);

    const added = await runSkill(baseUrl, [
      "add",
      "--markdown",
      "# Skill 新增便签\n\n这是一条 API feedback 记录。",
    ]);
    const addedNote = added.note as {
      id: string;
      isPinned: boolean;
      isStarred: boolean;
      markdown: string;
    };
    assert.match(addedNote.id, /^[0-9a-f-]{36}$/);
    assert.equal(addedNote.isPinned, false);
    assert.equal(addedNote.isStarred, false);
    assert.match(addedNote.markdown, /API feedback/);

    const folderCreated = await runSkill(baseUrl, [
      "folder-create",
      "--name",
      "工作",
    ]);
    const folder = folderCreated.folder as { id: string; name: string };
    assert.equal(folder.name, "工作");

    const classified = await runSkill(baseUrl, [
      "classify",
      "--note-id",
      addedNote.id,
      "--folder",
      "工作",
    ]);
    assert.equal(
      (classified.note as { folderId: string }).folderId,
      folder.id,
    );

    const starred = await runSkill(baseUrl, [
      "star",
      "--note-id",
      addedNote.id,
      "--state",
      "on",
    ]);
    assert.equal((starred.note as { isStarred: boolean }).isStarred, true);

    const pinned = await runSkill(baseUrl, [
      "pin",
      "--note-id",
      addedNote.id,
      "--state",
      "on",
    ]);
    assert.equal((pinned.note as { isPinned: boolean }).isPinned, true);

    const listedByFolder = await runSkill(baseUrl, [
      "list",
      "--category",
      "工作",
    ]);
    assert.equal(listedByFolder.total, 1);
    assert.equal(
      ((listedByFolder.notes as Array<{ id: string }>)[0]).id,
      addedNote.id,
    );

    const starredList = await runSkill(baseUrl, [
      "list",
      "--category",
      "starred",
    ]);
    assert.equal(starredList.total, 1);

    const fetched = await runSkill(baseUrl, [
      "get",
      "--note-id",
      addedNote.id,
    ]);
    const fetchedNote = fetched.note as {
      folderName: string;
      isPinned: boolean;
      isStarred: boolean;
      markdown: string;
    };
    assert.equal(fetchedNote.folderName, "工作");
    assert.equal(fetchedNote.isPinned, true);
    assert.equal(fetchedNote.isStarred, true);
    assert.match(fetchedNote.markdown, /Skill 新增便签/);

    const htmlPath = path.join(outputDir, "wechat.html");
    const wechat = await runSkill(baseUrl, [
      "wechat",
      "--note-id",
      addedNote.id,
      "--output-html",
      htmlPath,
    ]);
    assert.equal(wechat.noteId, addedNote.id);
    assert.equal(wechat.htmlPath, htmlPath);
    assert.equal(wechat.imageCount, 0);
    const wechatHtml = await readFile(htmlPath, "utf8");
    assert.match(wechatHtml, /Skill 新增便签/);
    assert.match(wechatHtml, /via Smartisan Notes/);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "feedback-admin-password",
        username: "feedback-admin",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = getCookie(login);
    const workspaceResponse = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Cookie: cookie },
    });
    const stored = (await workspaceResponse.json()) as {
      updatedAt: number;
      workspace: NoteWorkspace;
    };
    const firstConditionalSave = await fetch(`${baseUrl}/api/workspace`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        expectedUpdatedAt: stored.updatedAt,
        workspace: stored.workspace,
      }),
    });
    assert.equal(firstConditionalSave.status, 200);
    const secondConditionalSave = await fetch(`${baseUrl}/api/workspace`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        expectedUpdatedAt: stored.updatedAt,
        workspace: stored.workspace,
      }),
    });
    assert.equal(secondConditionalSave.status, 409);
    assert.match(
      ((await secondConditionalSave.json()) as { error: string }).error,
      /读取最新版本后重试/,
    );
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.stack || error.message : String(error),
        `backend stdout:\n${stdout}`,
        `backend stderr:\n${stderr}`,
      ].join("\n\n"),
    );
  }
});
