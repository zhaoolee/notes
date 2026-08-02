import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import { spawn, type ChildProcess } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { NoteWorkspace } from "../../src/types/app.js";

const execFileAsync = promisify(execFile);
const workspaceSkillScript = path.resolve(
  "skills/notes-workspace-api/scripts/notes_api.mjs",
);

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配 Skill Token feedback 测试端口");
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
      throw new Error(`后端在 Skill Token 测试前退出，退出码：${child.exitCode}`);
    }

    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) {
        return;
      }
    } catch {
      // 服务仍在启动。
    }

    await delay(100);
  }

  throw new Error("等待 Skill Token feedback 测试后端超时");
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
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function postJson(
  baseUrl: string,
  pathname: string,
  body: unknown,
  cookie?: string,
  origin?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, inflateRawSync(compressed));
    offset = dataStart + compressedSize;
  }

  return entries;
}

function createWorkspace(timestamp: number): NoteWorkspace {
  return {
    activeNoteId: "skill-token-note",
    folders: [],
    notes: [
      {
        id: "skill-token-note",
        markdown: "# Skill Token feedback",
        createdAt: timestamp,
        updatedAt: timestamp,
        normalOrder: 0,
        pinnedAt: null,
        folderId: null,
        isStarred: false,
        deletedAt: null,
      },
    ],
    version: 1,
  };
}

test("Skill Token 可自动换取、持久化、下载 ZIP，并在改密后失效", async (context) => {
  const port = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-token-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-token-images-"));
  const outputDir = await mkdtemp(path.join(tmpdir(), "notes-token-output-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_STORAGE_DIR: dataDir,
      IMAGE_STORAGE_DIR: imageDir,
      PORT: String(port),
      SESSION_SECRET: "feedback-skill-token-session-secret",
      SUPERADMIN: "feedback-admin",
      SUPERADMINPASSWORD: "feedback-admin-password",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr?.on("data", (chunk) => (stderr += String(chunk)));

  context.after(async () => {
    await stopChild(child);
    await rm(dataDir, { force: true, recursive: true });
    await rm(imageDir, { force: true, recursive: true });
    await rm(outputDir, { force: true, recursive: true });
  });

  try {
    await waitForHealth(baseUrl, child);

    const adminLogin = await postJson(baseUrl, "/api/superadmin/login", {
      password: "feedback-admin-password",
      remember: false,
      username: "feedback-admin",
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = getCookie(adminLogin);
    const createUser = await postJson(
      baseUrl,
      "/api/superadmin/users",
      { username: "feedback-token-user" },
      adminCookie,
    );
    assert.equal(createUser.status, 201);
    const created = (await createUser.json()) as {
      user: { initialPassword: string; username: string };
    };
    const initialPassword = created.user.initialPassword;

    const userLogin = await postJson(baseUrl, "/api/auth/login", {
      password: initialPassword,
      remember: false,
      username: created.user.username,
    });
    assert.equal(userLogin.status, 200);
    const userCookie = getCookie(userLogin);

    const rejectedOrigin = await postJson(
      baseUrl,
      "/api/auth/skill-token",
      { password: initialPassword, username: created.user.username },
      undefined,
      "https://evil.example",
    );
    assert.equal(rejectedOrigin.status, 403);

    const tokenResponse = await postJson(baseUrl, "/api/auth/skill-token", {
      password: initialPassword,
      username: created.user.username,
    });
    assert.equal(tokenResponse.status, 200);
    assert.match(tokenResponse.headers.get("cache-control") ?? "", /no-store/);
    const { token } = (await tokenResponse.json()) as { token: string };
    assert.match(token, /^notes_sk_v1\./);

    const repeatedTokenResponse = await postJson(
      baseUrl,
      "/api/auth/skill-token",
      { password: initialPassword, username: created.user.username },
    );
    assert.equal(repeatedTokenResponse.status, 200);
    assert.equal(
      ((await repeatedTokenResponse.json()) as { token: string }).token,
      token,
    );

    const saveWorkspace = await fetch(`${baseUrl}/api/workspace`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspace: createWorkspace(500) }),
    });
    assert.equal(saveWorkspace.status, 200);
    const readWorkspace = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(readWorkspace.status, 200);
    assert.equal(
      ((await readWorkspace.json()) as { workspace: NoteWorkspace }).workspace.notes[0]
        .markdown,
      "# Skill Token feedback",
    );

    const browserSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.deepEqual(await browserSession.json(), { user: null });
    const aiRequest = await fetch(`${baseUrl}/api/ai/suggestions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ instruction: "检查", markdown: "正文" }),
    });
    assert.equal(aiRequest.status, 401);

    const packageResponse = await fetch(`${baseUrl}/api/hermes-skill/download`, {
      method: "POST",
      headers: { Cookie: userCookie },
    });
    assert.equal(packageResponse.status, 200);
    assert.equal(packageResponse.headers.get("content-type"), "application/zip");
    assert.match(
      packageResponse.headers.get("content-disposition") ?? "",
      /notes-workspace-api\.zip/,
    );
    const entries = readZipEntries(Buffer.from(await packageResponse.arrayBuffer()));
    assert.deepEqual([...entries.keys()].sort(), [
      "notes-workspace-api/.env",
      "notes-workspace-api/SKILL.md",
      "notes-workspace-api/references/workspace-api.md",
      "notes-workspace-api/scripts/notes_api.mjs",
    ]);
    const packagedEnv = entries.get("notes-workspace-api/.env")?.toString("utf8") ?? "";
    assert.match(packagedEnv, new RegExp(`NOTES_API_BASE_URL=${baseUrl}`));
    assert.match(packagedEnv, new RegExp(`NOTES_API_TOKEN=${token.replaceAll(".", "\\.")}`));
    assert.doesNotMatch(packagedEnv, /PASSWORD|USERNAME/);

    const rejectedInstallLink = await postJson(
      baseUrl,
      "/api/hermes-skill/install-link",
      {},
      userCookie,
      "https://evil.example",
    );
    assert.equal(rejectedInstallLink.status, 403);

    const installLinkResponse = await postJson(
      baseUrl,
      "/api/hermes-skill/install-link",
      {},
      userCookie,
    );
    assert.equal(installLinkResponse.status, 200);
    assert.match(installLinkResponse.headers.get("cache-control") ?? "", /no-store/);
    const installLink = (await installLinkResponse.json()) as {
      installUrl: string;
    };
    assert.deepEqual(Object.keys(installLink), ["installUrl"]);
    assert.match(
      installLink.installUrl,
      new RegExp(
        `^${baseUrl.replaceAll(".", "\\.")}\/api\/hermes-skill\/install\/notes_hi_v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}\/notes-workspace-api\\.zip$`,
      ),
    );
    assert.doesNotMatch(installLink.installUrl, /notes_sk_v1/);

    const repeatedInstallLinkResponse = await postJson(
      baseUrl,
      "/api/hermes-skill/install-link",
      {},
      userCookie,
    );
    assert.equal(repeatedInstallLinkResponse.status, 200);
    const repeatedInstallLink = (await repeatedInstallLinkResponse.json()) as {
      installUrl: string;
    };
    assert.equal(repeatedInstallLink.installUrl, installLink.installUrl);

    const installProbe = await fetch(installLink.installUrl, { method: "HEAD" });
    assert.equal(installProbe.status, 200);
    assert.match(installProbe.headers.get("cache-control") ?? "", /no-store/);
    const installDownload = await fetch(installLink.installUrl);
    assert.equal(installDownload.status, 200);
    assert.equal(installDownload.headers.get("content-type"), "application/zip");
    const installEntries = readZipEntries(
      Buffer.from(await installDownload.arrayBuffer()),
    );
    assert.deepEqual([...installEntries.keys()].sort(), [...entries.keys()].sort());
    assert.equal(
      installEntries.get("notes-workspace-api/.env")?.toString("utf8"),
      packagedEnv,
    );
    const secondDeviceDownload = await fetch(installLink.installUrl);
    assert.equal(secondDeviceDownload.status, 200);

    const resetInstallLinkResponse = await postJson(
      baseUrl,
      "/api/hermes-skill/install-link/reset",
      {},
      userCookie,
    );
    assert.equal(resetInstallLinkResponse.status, 200);
    const resetInstallLink = (await resetInstallLinkResponse.json()) as {
      installUrl: string;
    };
    assert.notEqual(resetInstallLink.installUrl, installLink.installUrl);
    assert.equal((await fetch(installLink.installUrl)).status, 410);
    assert.equal((await fetch(resetInstallLink.installUrl)).status, 200);

    const envFile = path.join(outputDir, "notes-api.env");
    await writeFile(
      envFile,
      [
        `NOTES_API_BASE_URL=${baseUrl}`,
        `NOTES_API_USERNAME=${created.user.username}`,
        `NOTES_API_PASSWORD=${initialPassword}`,
        "",
      ].join("\n"),
      "utf8",
    );
    const skillResult = await execFileAsync(
      process.execPath,
      [workspaceSkillScript, "list", "--env-file", envFile],
      { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 },
    );
    assert.equal((JSON.parse(skillResult.stdout) as { total: number }).total, 1);
    const rewrittenEnv = await readFile(envFile, "utf8");
    assert.match(rewrittenEnv, new RegExp(`NOTES_API_TOKEN=${token.replaceAll(".", "\\.")}`));
    assert.doesNotMatch(rewrittenEnv, /NOTES_API_USERNAME|NOTES_API_PASSWORD/);
    assert.equal((await stat(envFile)).mode & 0o777, 0o600);

    const tokenOnlyEnvFile = path.join(outputDir, "notes-token-only.env");
    await writeFile(
      tokenOnlyEnvFile,
      [
        `NOTES_API_BASE_URL=${baseUrl}`,
        `NOTES_API_TOKEN=${token}`,
        "NOTES_API_USERNAME=wrong-user",
        "NOTES_API_PASSWORD=wrong-password",
        "",
      ].join("\n"),
      "utf8",
    );
    const tokenOnlyResult = await execFileAsync(
      process.execPath,
      [workspaceSkillScript, "list", "--env-file", tokenOnlyEnvFile],
      { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 },
    );
    assert.equal(
      (JSON.parse(tokenOnlyResult.stdout) as { total: number }).total,
      1,
    );
    assert.match(await readFile(tokenOnlyEnvFile, "utf8"), /wrong-password/);

    const passwordChange = await postJson(
      baseUrl,
      "/api/auth/password",
      { currentPassword: initialPassword, newPassword: "feedback-new-password" },
      userCookie,
    );
    assert.equal(passwordChange.status, 200);
    assert.equal((await fetch(resetInstallLink.installUrl)).status, 410);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/workspace`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      401,
    );

    const databaseText = await readFile(path.join(dataDir, "notes-data.json"), "utf8");
    assert.ok(!databaseText.includes(token), "服务端持久化文件不得保存明文 Skill Token");
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
});
