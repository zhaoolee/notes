import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
const exportScript = path.resolve(
  "skills/notes-export-api/scripts/export_note.sh",
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
      "--username",
      "feedback-admin",
      "--password",
      "feedback-admin-password",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test("便签管理 Skill 可用账号密码完成增删改查、分类和公众号格式", async (context) => {
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

    const envFile = path.join(outputDir, "notes-api.env");
    await writeFile(
      envFile,
      [
        `NOTES_API_BASE_URL=${baseUrl}`,
        "NOTES_API_USERNAME=feedback-admin",
        "NOTES_API_PASSWORD=feedback-admin-password",
        "",
      ].join("\n"),
      "utf8",
    );
    const configuredByFile = await execFileAsync(
      process.execPath,
      [skillScript, "list", "--env-file", envFile],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NOTES_API_BASE_URL: "http://127.0.0.1:1",
          NOTES_API_PASSWORD: "wrong-ambient-password",
          NOTES_API_USERNAME: "wrong-ambient-user",
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const envFileList = JSON.parse(configuredByFile.stdout) as {
      notes: unknown[];
      total: number;
    };
    assert.equal(envFileList.total, 0);
    assert.deepEqual(envFileList.notes, []);

    const fakeBinDir = path.join(outputDir, "fake-bin");
    const fakeCurl = path.join(fakeBinDir, "curl");
    const fakeCurlLog = path.join(outputDir, "fake-curl-url.txt");
    await mkdir(fakeBinDir);
    await writeFile(
      fakeCurl,
      `#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    -H|--data-binary)
      shift 2
      ;;
    -sS)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
printf 'fake-png' > "$output"
printf '%s' "$url" > "$FAKE_CURL_LOG"
`,
      "utf8",
    );
    await chmod(fakeCurl, 0o755);
    const exportOutput = path.join(outputDir, "configured-by-env.png");
    await execFileAsync(
      exportScript,
      [
        "--env-file",
        envFile,
        "--markdown",
        "# 统一地址测试",
        "--output",
        exportOutput,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FAKE_CURL_LOG: fakeCurlLog,
          NOTES_API_BASE_URL: "http://127.0.0.1:1",
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    assert.equal(
      await readFile(fakeCurlLog, "utf8"),
      `${baseUrl}/api/export`,
    );
    assert.equal(await readFile(exportOutput, "utf8"), "fake-png");

    const commandLineBaseUrl = "http://127.0.0.1:29999";
    await execFileAsync(
      exportScript,
      [
        "--env-file",
        envFile,
        "--base-url",
        commandLineBaseUrl,
        "--markdown",
        "# 命令行地址覆盖测试",
        "--output",
        path.join(outputDir, "configured-by-argument.png"),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          FAKE_CURL_LOG: fakeCurlLog,
          PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );
    assert.equal(
      await readFile(fakeCurlLog, "utf8"),
      `${commandLineBaseUrl}/api/export`,
    );

    const missingBaseUrlEnv = path.join(outputDir, "missing-base-url.env");
    await writeFile(
      missingBaseUrlEnv,
      [
        "NOTES_API_USERNAME=feedback-admin",
        "NOTES_API_PASSWORD=feedback-admin-password",
        "",
      ].join("\n"),
      "utf8",
    );
    const missingBaseUrlProcessEnv = {
      ...process.env,
      NOTES_API_BASE_URL: "",
    };
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [skillScript, "list", "--env-file", missingBaseUrlEnv],
        {
          cwd: process.cwd(),
          env: missingBaseUrlProcessEnv,
        },
      ),
      /缺少服务地址/,
    );
    await assert.rejects(
      execFileAsync(
        exportScript,
        [
          "--env-file",
          missingBaseUrlEnv,
          "--markdown",
          "# 缺少服务地址",
          "--output",
          path.join(outputDir, "missing-base-url.png"),
        ],
        {
          cwd: process.cwd(),
          env: missingBaseUrlProcessEnv,
        },
      ),
      /缺少服务地址/,
    );

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
      updatedAt: number;
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

    const updated = await runSkill(baseUrl, [
      "update",
      "--note-id",
      addedNote.id,
      "--markdown",
      "# Skill 修改便签\n\n正文已通过 API 更新。",
    ]);
    const updatedNote = updated.note as {
      id: string;
      markdown: string;
      updatedAt: number;
    };
    assert.equal(updatedNote.id, addedNote.id);
    assert.match(updatedNote.markdown, /正文已通过 API 更新/);
    assert.ok(updatedNote.updatedAt >= addedNote.updatedAt);

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
    assert.match(wechatHtml, /Skill 修改便签/);
    assert.match(wechatHtml, /via Smartisan Notes/);

    await assert.rejects(
      runSkill(baseUrl, [
        "delete",
        "--note-id",
        addedNote.id,
        "--permanent",
      ]),
      /永久删除只允许回收站中的便签/,
    );

    const movedToTrash = await runSkill(baseUrl, [
      "delete",
      "--note-id",
      addedNote.id,
    ]);
    const trashedNote = movedToTrash.note as {
      deletedAt: number;
      id: string;
      isPinned: boolean;
    };
    assert.equal(trashedNote.id, addedNote.id);
    assert.equal(trashedNote.isPinned, false);
    assert.equal(typeof trashedNote.deletedAt, "number");

    const liveAfterDelete = await runSkill(baseUrl, ["list"]);
    assert.equal(
      (liveAfterDelete.notes as Array<{ id: string }>).some(
        (note) => note.id === addedNote.id,
      ),
      false,
    );
    const trashAfterDelete = await runSkill(baseUrl, [
      "list",
      "--category",
      "trash",
    ]);
    assert.equal(trashAfterDelete.total, 1);
    assert.equal(
      (trashAfterDelete.notes as Array<{ id: string }>)[0].id,
      addedNote.id,
    );

    const restored = await runSkill(baseUrl, [
      "restore",
      "--note-id",
      addedNote.id,
    ]);
    assert.equal((restored.note as { deletedAt: null }).deletedAt, null);

    await runSkill(baseUrl, ["delete", "--note-id", addedNote.id]);
    const permanentlyDeleted = await runSkill(baseUrl, [
      "delete",
      "--note-id",
      addedNote.id,
      "--permanent",
    ]);
    const deleted = permanentlyDeleted.deleted as {
      activeNoteId: string;
      id: string;
      permanent: boolean;
    };
    assert.match(deleted.activeNoteId, /^[0-9a-f-]{36}$/);
    assert.equal(deleted.id, addedNote.id);
    assert.equal(deleted.permanent, true);
    const trashAfterPermanentDelete = await runSkill(baseUrl, [
      "list",
      "--category",
      "trash",
    ]);
    assert.equal(trashAfterPermanentDelete.total, 0);

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
