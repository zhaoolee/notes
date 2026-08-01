import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { NoteWorkspace } from "../../src/types/app.js";

interface CreatedUser {
  createdAt: number;
  id: string;
  initialPassword: string;
  username: string;
}

interface ResetUserPassword {
  createdAt: number;
  id: string;
  temporaryPassword: string;
  username: string;
}

async function getUnusedPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();

  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("无法分配认证 feedback 测试端口");
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
      throw new Error(`后端在认证测试前退出，退出码：${child.exitCode}`);
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

  throw new Error("等待认证测试后端超时");
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

function createWorkspace(label: string, timestamp: number): NoteWorkspace {
  const noteId = `note-${label}`;

  return {
    activeNoteId: noteId,
    folders: [],
    notes: [
      {
        id: noteId,
        markdown: `# ${label}`,
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

async function postJson(
  baseUrl: string,
  pathname: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("管理员可使用便签服务、创建用户且各账号云工作区严格隔离", async (context) => {
  const port = await getUnusedPort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-auth-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-auth-images-"));
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
  });

  try {
    await waitForHealth(baseUrl, child);

    const wrongAdminLogin = await postJson(
      baseUrl,
      "/api/superadmin/login",
      {
        password: "wrong-password",
        remember: true,
        username: "feedback-admin",
      },
    );
    assert.equal(wrongAdminLogin.status, 401);

    const adminLogin = await postJson(baseUrl, "/api/superadmin/login", {
      password: "feedback-admin-password",
      remember: true,
      username: "feedback-admin",
    });
    assert.equal(adminLogin.status, 200);
    const adminSetCookie = adminLogin.headers.get("set-cookie") || "";
    assert.match(adminSetCookie, /HttpOnly/i);
    assert.match(adminSetCookie, /SameSite=Lax/i);
    assert.match(adminSetCookie, /Max-Age=2592000/i);
    const adminCookie = getCookie(adminLogin);

    const adminInitialWorkspace = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(adminInitialWorkspace.status, 200);
    assert.deepEqual(await adminInitialWorkspace.json(), {
      updatedAt: null,
      workspace: null,
    });

    const adminWorkspace = createWorkspace("admin-private", 500);
    const adminSave = await fetch(`${baseUrl}/api/workspace`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ workspace: adminWorkspace }),
    });
    assert.equal(adminSave.status, 200);

    const adminNotesLogin = await postJson(baseUrl, "/api/auth/login", {
      password: "feedback-admin-password",
      remember: false,
      username: "FEEDBACK-ADMIN",
    });
    assert.equal(adminNotesLogin.status, 200);
    assert.deepEqual(
      ((await adminNotesLogin.clone().json()) as {
        user: { id: string; role: string; username: string };
      }).user,
      {
        id: "superadmin",
        role: "superadmin",
        username: "feedback-admin",
      },
    );
    const adminNotesCookie = getCookie(adminNotesLogin);
    const adminWorkspaceRead = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Cookie: adminNotesCookie },
    });
    assert.equal(adminWorkspaceRead.status, 200);
    const storedAdminWorkspace = (await adminWorkspaceRead.json()) as {
      workspace: NoteWorkspace;
    };
    assert.equal(
      storedAdminWorkspace.workspace.notes[0].markdown,
      "# admin-private",
    );

    const aliceResponse = await postJson(
      baseUrl,
      "/api/superadmin/users",
      { username: "alice" },
      adminCookie,
    );
    assert.equal(aliceResponse.status, 201);
    const alice = ((await aliceResponse.json()) as { user: CreatedUser }).user;
    assert.equal(alice.username, "alice");
    assert.match(alice.initialPassword, /^[A-Za-z0-9]{16}$/);

    const bobResponse = await postJson(
      baseUrl,
      "/api/superadmin/users",
      { username: "bob.user+sync@example.com" },
      adminCookie,
    );
    assert.equal(bobResponse.status, 201);
    const bob = ((await bobResponse.json()) as { user: CreatedUser }).user;

    const duplicateResponse = await postJson(
      baseUrl,
      "/api/superadmin/users",
      { username: "ALICE" },
      adminCookie,
    );
    assert.equal(duplicateResponse.status, 409);

    const usersResponse = await fetch(`${baseUrl}/api/superadmin/users`, {
      headers: { Cookie: adminCookie },
    });
    assert.equal(usersResponse.status, 200);
    const users = (await usersResponse.json()) as {
      users: Array<{ id: string; username: string }>;
    };
    assert.deepEqual(
      new Set(users.users.map((user) => user.username)),
      new Set(["alice", "bob.user+sync@example.com"]),
    );
    assert.doesNotMatch(JSON.stringify(users), /password|salt|hash/i);

    const aliceLogin = await postJson(baseUrl, "/api/auth/login", {
      password: alice.initialPassword,
      remember: false,
      username: "alice",
    });
    assert.equal(aliceLogin.status, 200);
    assert.doesNotMatch(aliceLogin.headers.get("set-cookie") || "", /Max-Age/i);
    const aliceCookie = getCookie(aliceLogin);

    const aliceWorkspace = createWorkspace("alice-private", 1_000);
    const aliceSave = await fetch(`${baseUrl}/api/workspace`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: aliceCookie,
      },
      body: JSON.stringify({ workspace: aliceWorkspace }),
    });
    assert.equal(aliceSave.status, 200);

    const bobLogin = await postJson(baseUrl, "/api/auth/login", {
      password: bob.initialPassword,
      remember: true,
      username: "BOB.USER+SYNC@EXAMPLE.COM",
    });
    assert.equal(bobLogin.status, 200);
    const bobCookie = getCookie(bobLogin);

    const bobInitialWorkspace = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(bobInitialWorkspace.status, 200);
    assert.deepEqual(await bobInitialWorkspace.json(), {
      updatedAt: null,
      workspace: null,
    });

    const bobWorkspace = createWorkspace("bob-private", 2_000);
    const bobSave = await fetch(`${baseUrl}/api/workspace`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: bobCookie,
      },
      body: JSON.stringify({ workspace: bobWorkspace }),
    });
    assert.equal(bobSave.status, 200);

    const aliceRead = await fetch(`${baseUrl}/api/workspace`, {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(aliceRead.status, 200);
    const aliceStored = (await aliceRead.json()) as {
      workspace: NoteWorkspace;
    };
    assert.equal(aliceStored.workspace.notes[0].markdown, "# alice-private");

    const userCannotManage = await fetch(
      `${baseUrl}/api/superadmin/users`,
      {
        headers: { Cookie: aliceCookie },
      },
    );
    assert.equal(userCannotManage.status, 403);

    const userCannotResetPassword = await postJson(
      baseUrl,
      `/api/superadmin/users/${bob.id}/reset-password`,
      {},
      aliceCookie,
    );
    assert.equal(userCannotResetPassword.status, 403);

    const aliceSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: aliceCookie },
    });
    assert.deepEqual(await aliceSession.json(), {
      user: {
        id: alice.id,
        role: "user",
        username: "alice",
      },
    });

    const wrongCurrentPassword = await postJson(
      baseUrl,
      "/api/auth/password",
      {
        currentPassword: "not-alice-password",
        newPassword: "alice-new-password-2026",
      },
      aliceCookie,
    );
    assert.equal(wrongCurrentPassword.status, 400);

    const weakNewPassword = await postJson(
      baseUrl,
      "/api/auth/password",
      {
        currentPassword: alice.initialPassword,
        newPassword: "short",
      },
      aliceCookie,
    );
    assert.equal(weakNewPassword.status, 400);

    const aliceChangedPassword = "alice-new-password-2026";
    const aliceChangePassword = await postJson(
      baseUrl,
      "/api/auth/password",
      {
        currentPassword: alice.initialPassword,
        newPassword: aliceChangedPassword,
      },
      aliceCookie,
    );
    assert.equal(aliceChangePassword.status, 200);
    const aliceChangedCookie = getCookie(aliceChangePassword);

    const staleAliceSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: aliceCookie },
    });
    assert.deepEqual(await staleAliceSession.json(), { user: null });

    const oldAlicePasswordLogin = await postJson(baseUrl, "/api/auth/login", {
      password: alice.initialPassword,
      remember: false,
      username: "alice",
    });
    assert.equal(oldAlicePasswordLogin.status, 401);

    const changedAlicePasswordLogin = await postJson(
      baseUrl,
      "/api/auth/login",
      {
        password: aliceChangedPassword,
        remember: false,
        username: "alice",
      },
    );
    assert.equal(changedAlicePasswordLogin.status, 200);

    const resetAliceResponse = await postJson(
      baseUrl,
      `/api/superadmin/users/${alice.id}/reset-password`,
      {},
      adminCookie,
    );
    assert.equal(resetAliceResponse.status, 200);
    const resetAlice = (
      (await resetAliceResponse.json()) as { user: ResetUserPassword }
    ).user;
    assert.equal(resetAlice.username, "alice");
    assert.match(resetAlice.temporaryPassword, /^[A-Za-z0-9]{16}$/);
    assert.doesNotMatch(
      JSON.stringify(resetAlice),
      /passwordHash|passwordSalt/i,
    );

    const staleChangedSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: aliceChangedCookie },
    });
    assert.deepEqual(await staleChangedSession.json(), { user: null });

    const changedPasswordAfterReset = await postJson(
      baseUrl,
      "/api/auth/login",
      {
        password: aliceChangedPassword,
        remember: false,
        username: "alice",
      },
    );
    assert.equal(changedPasswordAfterReset.status, 401);

    const resetPasswordLogin = await postJson(baseUrl, "/api/auth/login", {
      password: resetAlice.temporaryPassword,
      remember: false,
      username: "alice",
    });
    assert.equal(resetPasswordLogin.status, 200);
    const resetAliceCookie = getCookie(resetPasswordLogin);

    const logoutResponse = await postJson(
      baseUrl,
      "/api/auth/logout",
      {},
      resetAliceCookie,
    );
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get("set-cookie") || "", /Max-Age=0/);

    const databaseText = await readFile(
      path.join(dataDir, "notes-data.json"),
      "utf8",
    );
    assert.doesNotMatch(databaseText, new RegExp(alice.initialPassword));
    assert.doesNotMatch(databaseText, new RegExp(bob.initialPassword));
    assert.doesNotMatch(databaseText, new RegExp(aliceChangedPassword));
    assert.doesNotMatch(databaseText, new RegExp(resetAlice.temporaryPassword));
    assert.doesNotMatch(databaseText, /feedback-admin-password/);
    assert.match(databaseText, /alice-private/);
    assert.match(databaseText, /bob-private/);
    assert.match(databaseText, /admin-private/);
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
