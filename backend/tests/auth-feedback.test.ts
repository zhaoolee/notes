import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
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

function extractPngFromMultipart(body: Buffer): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const iendChunk = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const start = body.indexOf(signature);
  const iend = body.indexOf(iendChunk, start);

  assert.ok(start >= 0);
  assert.ok(iend >= start);
  return body.subarray(start, iend + iendChunk.length);
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
  let wechatPort = await getUnusedPort();

  while (wechatPort === port) {
    wechatPort = await getUnusedPort();
  }
  const dataDir = await mkdtemp(path.join(tmpdir(), "notes-auth-data-"));
  const imageDir = await mkdtemp(path.join(tmpdir(), "notes-auth-images-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const wechatDraftPayloads: unknown[] = [];
  const wechatContentUploads: Buffer[] = [];
  const wechatCoverUploads: Buffer[] = [];
  let wechatContentImageSequence = 0;
  const wechatServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${wechatPort}`);
    response.setHeader("Content-Type", "application/json");

    if (request.method === "GET" && url.pathname === "/cgi-bin/token") {
      response.end(
        JSON.stringify({
          access_token: `token-${url.searchParams.get("appid")}`,
          expires_in: 7_200,
        }),
      );
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/cgi-bin/media/uploadimg"
    ) {
      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      wechatContentUploads.push(Buffer.concat(chunks));
      wechatContentImageSequence += 1;
      response.end(
        JSON.stringify({
          errcode: 0,
          errmsg: "ok",
          url: `https://mmbiz.qpic.cn/feedback-${wechatContentImageSequence}.png`,
        }),
      );
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/cgi-bin/material/add_material"
    ) {
      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      wechatCoverUploads.push(Buffer.concat(chunks));
      response.end(
        JSON.stringify({
          media_id: "feedback-cover-media-id",
          url: "https://mmbiz.qpic.cn/feedback-cover.png",
        }),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/cgi-bin/draft/add") {
      const chunks: Buffer[] = [];

      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }

      wechatDraftPayloads.push(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      response.end(JSON.stringify({ media_id: "feedback-draft-media-id" }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ errcode: 404, errmsg: "not found" }));
  });
  wechatServer.listen(wechatPort, "127.0.0.1");
  await once(wechatServer, "listening");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_STORAGE_DIR: dataDir,
        IMAGE_STORAGE_DIR: imageDir,
        AppID: "wxaaaaaaaaaaaaaaaa",
        AppSecret: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        PORT: String(port),
        SESSION_SECRET: "feedback-session-secret-with-sufficient-entropy",
        SUPERADMIN: "feedback-admin",
        SUPERADMINPASSWORD: "feedback-admin-password",
        WECHAT_API_BASE_URL: `http://127.0.0.1:${wechatPort}`,
        WECHAT_FOOTER_HAMMER_URL:
          "/smartisan/mobile/dark/note_background.webp",
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
    wechatServer.close();
    await once(wechatServer, "close");
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

    const anonymousWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
    );
    assert.equal(anonymousWechatConfiguration.status, 401);

    const initialWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
      { headers: { Cookie: adminNotesCookie } },
    );
    assert.equal(initialWechatConfiguration.status, 200);
    assert.match(
      initialWechatConfiguration.headers.get("cache-control") || "",
      /no-store/,
    );
    assert.deepEqual(await initialWechatConfiguration.json(), {
      appId: "",
      appSecret: "",
      updatedAt: null,
    });

    const invalidWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminNotesCookie,
        },
        body: JSON.stringify({
          appId: "not-a-wechat-app-id",
          appSecret: "too-short",
        }),
      },
    );
    assert.equal(invalidWechatConfiguration.status, 400);

    const savedWechatAppId = "wx1234567890abcdef";
    const savedWechatAppSecret = "0123456789abcdef0123456789abcdef";
    const saveWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminNotesCookie,
        },
        body: JSON.stringify({
          appId: savedWechatAppId,
          appSecret: savedWechatAppSecret,
        }),
      },
    );
    assert.equal(saveWechatConfiguration.status, 200);
    const savedWechatConfiguration = (await saveWechatConfiguration.json()) as {
      appId: string;
      appSecret: string;
      configured: boolean;
      connected: boolean;
      connectionError: string | null;
      updatedAt: number;
    };
    assert.equal(savedWechatConfiguration.appId, savedWechatAppId);
    assert.equal(savedWechatConfiguration.appSecret, savedWechatAppSecret);
    assert.equal(savedWechatConfiguration.configured, true);
    assert.equal(savedWechatConfiguration.connected, true);
    assert.equal(savedWechatConfiguration.connectionError, null);
    assert.ok(savedWechatConfiguration.updatedAt > 0);

    const echoedWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
      { headers: { Cookie: adminNotesCookie } },
    );
    assert.deepEqual(await echoedWechatConfiguration.json(), {
      appId: savedWechatAppId,
      appSecret: savedWechatAppSecret,
      updatedAt: savedWechatConfiguration.updatedAt,
    });

    const adminWechatStatus = await fetch(`${baseUrl}/api/wechat/status`, {
      headers: { Cookie: adminNotesCookie },
    });
    assert.equal(adminWechatStatus.status, 200);
    assert.deepEqual(
      {
        ...(await adminWechatStatus.json()),
        checkedAt: null,
      },
      {
        configured: true,
        connected: true,
        connectionError: null,
        checkedAt: null,
      },
    );

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

    const aliceInitialWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
      { headers: { Cookie: aliceCookie } },
    );
    assert.equal(aliceInitialWechatConfiguration.status, 200);
    assert.deepEqual(await aliceInitialWechatConfiguration.json(), {
      appId: "",
      appSecret: "",
      updatedAt: null,
    });

    const aliceWechatAppId = "wxfedcba0987654321";
    const aliceWechatAppSecret = "fedcba9876543210fedcba9876543210";
    const aliceSaveWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: aliceCookie,
        },
        body: JSON.stringify({
          appId: aliceWechatAppId,
          appSecret: aliceWechatAppSecret,
        }),
      },
    );
    assert.equal(aliceSaveWechatConfiguration.status, 200);

    const aliceEchoedWechatConfiguration = await fetch(
      `${baseUrl}/api/wechat/config`,
      { headers: { Cookie: aliceCookie } },
    );
    const aliceWechatConfiguration =
      (await aliceEchoedWechatConfiguration.json()) as {
        appId: string;
        appSecret: string;
      };
    assert.equal(aliceWechatConfiguration.appId, aliceWechatAppId);
    assert.equal(aliceWechatConfiguration.appSecret, aliceWechatAppSecret);

    const aliceDraftResponse = await postJson(
      baseUrl,
      "/api/wechat/draft",
      {
        footerBrand: "由 feedback 便签发送",
        footerVia: "Powered by feedback",
        markdown: "# Alice 的公众号草稿\n\n正文内容",
        theme: "default",
      },
      aliceCookie,
    );
    assert.equal(aliceDraftResponse.status, 200);
    assert.deepEqual(await aliceDraftResponse.json(), {
      imageCount: 1,
      mediaId: "feedback-draft-media-id",
      theme: "default",
      title: "Alice 的公众号草稿",
    });
    assert.equal(wechatDraftPayloads.length, 1);
    assert.equal(wechatContentUploads.length, 1);
    assert.equal(wechatCoverUploads.length, 1);
    const firstCoverUpload = wechatCoverUploads[0].toString("latin1");
    const firstCoverFilename = firstCoverUpload.match(
      /filename="(wechat-cover-title-[a-f0-9]+\.png)"/,
    )?.[1];
    assert.ok(firstCoverFilename);
    const firstCoverPng = extractPngFromMultipart(wechatCoverUploads[0]);
    const firstCoverMetadata = await sharp(firstCoverPng).metadata();
    const firstCoverStats = await sharp(firstCoverPng).stats();
    assert.equal(firstCoverMetadata.width, 900);
    assert.equal(firstCoverMetadata.height, 383);
    assert.ok(firstCoverStats.channels.some((channel) => channel.stdev > 5));
    assert.match(
      wechatContentUploads[0].toString("latin1"),
      /filename="wechat-[a-f0-9]+\.(?:jpg|png)"/,
    );
    assert.doesNotMatch(
      wechatContentUploads[0].toString("latin1"),
      /\.webp"/,
    );
    const [aliceDraftArticle] = (
      wechatDraftPayloads[0] as {
        articles: Array<{
          article_type: string;
          content: string;
          thumb_media_id: string;
          title: string;
        }>;
      }
    ).articles;
    assert.equal(aliceDraftArticle.article_type, "news");
    assert.equal(aliceDraftArticle.title, "Alice 的公众号草稿");
    assert.equal(
      aliceDraftArticle.thumb_media_id,
      "feedback-cover-media-id",
    );
    assert.match(
      aliceDraftArticle.content,
      /https:\/\/mmbiz\.qpic\.cn\/feedback-1\.png/,
    );
    assert.doesNotMatch(
      aliceDraftArticle.content,
      /notes\.fangyuanxiaozhan\.com\/images/,
    );

    const compactLongDraftMarkdown = [
      "# 程序员狠话｜长度回归",
      ...Array.from({ length: 10 }, (_, index) =>
        [
          `## **0x${String(index + 1).padStart(2, "0")}**`,
          `> 话题：第 ${index + 1} 条长文章主题保持原有排版`,
          "这是一段用于验证公众号草稿长度的正文。系统应保留标题、引用、正文、链接与空行的主题样式，同时让段落从文章容器继承相同的字体、字号、颜色和行高，避免为每一段重复写入完全相同的内联声明。",
          `来源：https://example.com/items/${index + 1}`,
        ].join("\n\n"),
      ),
    ].join("\n\n");
    const compactLongDraftResponse = await postJson(
      baseUrl,
      "/api/wechat/draft",
      {
        markdown: compactLongDraftMarkdown,
        theme: "apple-notes",
      },
      aliceCookie,
    );
    assert.equal(compactLongDraftResponse.status, 200);
    assert.equal(wechatDraftPayloads.length, 2);
    assert.equal(wechatCoverUploads.length, 2);
    const secondCoverFilename = wechatCoverUploads[1]
      .toString("latin1")
      .match(/filename="(wechat-cover-title-[a-f0-9]+\.png)"/)?.[1];
    assert.ok(secondCoverFilename);
    assert.notEqual(secondCoverFilename, firstCoverFilename);
    const compactLongDraftArticle = (
      wechatDraftPayloads[1] as {
        articles: Array<{ content: string; title: string }>;
      }
    ).articles[0];
    assert.equal(compactLongDraftArticle.title, "程序员狠话｜长度回归");
    assert.ok(Array.from(compactLongDraftArticle.content).length < 13_000);
    assert.match(compactLongDraftArticle.content, /items\/10/);

    const adminWechatConfigurationAfterAliceSave = await fetch(
      `${baseUrl}/api/wechat/config`,
      { headers: { Cookie: adminNotesCookie } },
    );
    assert.deepEqual(await adminWechatConfigurationAfterAliceSave.json(), {
      appId: savedWechatAppId,
      appSecret: savedWechatAppSecret,
      updatedAt: savedWechatConfiguration.updatedAt,
    });

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

    const bobWechatStatus = await fetch(`${baseUrl}/api/wechat/status`, {
      headers: { Cookie: bobCookie },
    });
    assert.deepEqual(await bobWechatStatus.json(), {
      configured: false,
      connected: false,
      connectionError: null,
      checkedAt: null,
    });

    const bobDraftWithoutConfiguration = await postJson(
      baseUrl,
      "/api/wechat/draft",
      { markdown: "# Bob 草稿", theme: "default" },
      bobCookie,
    );
    assert.equal(bobDraftWithoutConfiguration.status, 409);

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
    assert.match(databaseText, new RegExp(savedWechatAppId));
    assert.match(databaseText, new RegExp(savedWechatAppSecret));
    assert.match(databaseText, new RegExp(aliceWechatAppId));
    assert.match(databaseText, new RegExp(aliceWechatAppSecret));
    assert.doesNotMatch(databaseText, /wxaaaaaaaaaaaaaaaa/);
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
