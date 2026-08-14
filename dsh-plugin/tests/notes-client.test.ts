// notes-client 单元测试：mock fetch，不启动真实后端。
import assert from "node:assert/strict";
import { access, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildNoteUrl,
  DEFAULT_DEMO_SERVER,
  extractNoteTitle,
  NotesApiError,
  NotesClient,
  readConfiguredBaseUrl,
  resolveDemoServer,
  resolveFolderId,
  resolveServiceConfig,
  savePngToTempFile,
} from "../src/notes-client.js";
import type { NoteWorkspace } from "../src/types.js";

/** 构造可断言请求的 mock fetch。 */
function createMockFetch(
  handler: (
    method: string,
    pathname: string,
    init: RequestInit,
  ) => { status?: number; body?: unknown; response?: Response },
) {
  const calls: Array<{ method: string; pathname: string; body?: unknown }> = [];

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, pathname: url.pathname, body });
    const outcome = handler(method, url.pathname, init);

    if (outcome.response) {
      return outcome.response;
    }

    return new Response(
      outcome.body === undefined ? null : JSON.stringify(outcome.body),
      {
        status: outcome.status ?? 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  return { fetchImpl, calls };
}

function sampleWorkspace(): NoteWorkspace {
  return {
    activeNoteId: "",
    folders: [{ id: "folder-1", name: "工作", createdAt: 1 }],
    notes: [
      {
        id: "note-existing",
        markdown: "旧内容",
        createdAt: 100,
        updatedAt: 100,
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

test("resolveServiceConfig：缺地址报错、环境变量回退、去尾部斜杠、显式优先", () => {
  const previous = process.env.NOTES_API_BASE_URL;
  delete process.env.NOTES_API_BASE_URL;
  try {
    assert.throws(() => resolveServiceConfig(), NotesApiError);
    assert.throws(() => resolveServiceConfig({}), NotesApiError);
  } finally {
    if (previous === undefined) {
      delete process.env.NOTES_API_BASE_URL;
    } else {
      process.env.NOTES_API_BASE_URL = previous;
    }
  }

  process.env.NOTES_API_BASE_URL = "http://127.0.0.1:18080/";
  process.env.NOTES_API_TOKEN = "notes_sk_v1.test";
  try {
    const resolved = resolveServiceConfig();
    assert.equal(resolved.baseUrl, "http://127.0.0.1:18080");
    assert.equal(resolved.token, "notes_sk_v1.test");
  } finally {
    delete process.env.NOTES_API_BASE_URL;
    delete process.env.NOTES_API_TOKEN;
  }

  const explicit = resolveServiceConfig({
    baseUrl: "https://notes.example.com",
    token: "notes_sk_v1.explicit",
  });
  assert.equal(explicit.baseUrl, "https://notes.example.com");
  assert.equal(explicit.token, "notes_sk_v1.explicit");
});

test("readConfiguredBaseUrl：未配置返回 undefined，配置后返回去斜杠地址", () => {
  const previous = process.env.NOTES_API_BASE_URL;
  delete process.env.NOTES_API_BASE_URL;
  try {
    assert.equal(readConfiguredBaseUrl(), undefined);
    assert.equal(readConfiguredBaseUrl({}), undefined);
    assert.equal(
      readConfiguredBaseUrl({ baseUrl: "https://notes.example.com/" }),
      "https://notes.example.com",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.NOTES_API_BASE_URL;
    } else {
      process.env.NOTES_API_BASE_URL = previous;
    }
  }

  process.env.NOTES_API_BASE_URL = "http://127.0.0.1:18080/";
  try {
    assert.equal(readConfiguredBaseUrl(), "http://127.0.0.1:18080");
  } finally {
    delete process.env.NOTES_API_BASE_URL;
  }
});

test("resolveDemoServer：默认公共服务器、环境变量覆盖、显式覆盖", () => {
  const previous = process.env.NOTES_DEMO_SERVER;
  delete process.env.NOTES_DEMO_SERVER;
  try {
    assert.equal(resolveDemoServer(), DEFAULT_DEMO_SERVER);
    assert.equal(resolveDemoServer({ demoServer: "https://demo.example.com" }), "https://demo.example.com");
  } finally {
    if (previous === undefined) {
      delete process.env.NOTES_DEMO_SERVER;
    } else {
      process.env.NOTES_DEMO_SERVER = previous;
    }
  }

  process.env.NOTES_DEMO_SERVER = "https://mirror.example.com/";
  try {
    assert.equal(resolveDemoServer(), "https://mirror.example.com");
  } finally {
    delete process.env.NOTES_DEMO_SERVER;
  }
});

test("extractNoteTitle：首行、标题语法剥离、空内容默认、38 字截断", () => {
  assert.equal(extractNoteTitle("# 对话记录\n\n正文"), "对话记录");
  assert.equal(extractNoteTitle("> 引用首行"), "引用首行");
  assert.equal(extractNoteTitle("- 列表首行"), "列表首行");
  assert.equal(extractNoteTitle("1. 编号首行"), "编号首行");
  assert.equal(extractNoteTitle("   \n\n  "), "新便签");
  const long = extractNoteTitle(`${"长".repeat(40)}\n正文`);
  assert.equal(long.length, 38);
  assert.ok(long.endsWith("…"));
});

test("buildNoteUrl 与 resolveFolderId", () => {
  assert.equal(
    buildNoteUrl("http://127.0.0.1:18080", "abc"),
    "http://127.0.0.1:18080/#note=abc&view=preview",
  );

  const workspace = sampleWorkspace();
  assert.equal(resolveFolderId(workspace, "folder-1"), "folder-1");
  assert.equal(resolveFolderId(workspace, "工作"), "folder-1");
  assert.equal(resolveFolderId(workspace, "未分类"), null);
  assert.equal(resolveFolderId(workspace, "none"), null);
  assert.throws(() => resolveFolderId(workspace, "不存在"), NotesApiError);
});

test("exportNote：新建便签写入工作区头部", async () => {
  const { fetchImpl, calls } = createMockFetch((method, pathname) => {
    if (method === "GET" && pathname === "/api/workspace") {
      return { status: 200, body: { updatedAt: 10, workspace: sampleWorkspace() } };
    }
    if (method === "PUT" && pathname === "/api/workspace") {
      return { status: 200, body: { updatedAt: 11, workspace: null } };
    }
    return { status: 404, body: { error: "unexpected route" } };
  });

  const client = new NotesClient(
    { baseUrl: "http://127.0.0.1:18080", token: "notes_sk_v1.test" },
    fetchImpl,
  );
  const result = await client.exportNote({
    markdown: "# 对话\n\n用户：你好",
    starred: true,
    pinned: true,
  });

  assert.equal(result.action, "created");
  const createdNoteId = result.noteId;
  assert.ok(createdNoteId, "应返回便签 ID");
  assert.match(createdNoteId, /^[0-9a-f-]{36}$/);
  assert.equal(result.title, "对话");
  assert.equal(result.url, `http://127.0.0.1:18080/#note=${createdNoteId}&view=preview`);
  assert.equal(result.updatedAt, 11);
  assert.equal(result.server, "http://127.0.0.1:18080");
  assert.equal(result.filePath, null);

  const putCall = calls.find((call) => call.method === "PUT");
  assert.ok(putCall);
  const body = putCall.body as {
    expectedUpdatedAt: number | null;
    workspace: NoteWorkspace;
  };
  assert.equal(body.expectedUpdatedAt, 10);
  assert.equal(body.workspace.notes.length, 2);
  assert.equal(body.workspace.notes[0].markdown, "# 对话\n\n用户：你好");
  assert.equal(body.workspace.notes[0].isStarred, true);
  assert.ok(body.workspace.notes[0].pinnedAt !== null);
  assert.equal(body.workspace.activeNoteId, body.workspace.notes[0].id);
});

test("exportNote：无 token 时用账号密码申请 skill-token", async () => {
  const { fetchImpl, calls } = createMockFetch((method, pathname, init) => {
    if (method === "POST" && pathname === "/api/auth/skill-token") {
      assert.equal((JSON.parse(String(init.body)) as { username: string }).username, "user-a");
      return { status: 200, body: { token: "notes_sk_v1.minted" } };
    }
    if (method === "GET" && pathname === "/api/workspace") {
      return { status: 200, body: { updatedAt: null, workspace: null } };
    }
    if (method === "PUT" && pathname === "/api/workspace") {
      return { status: 200, body: { updatedAt: 1, workspace: null } };
    }
    return { status: 404, body: { error: "unexpected route" } };
  });

  const client = new NotesClient(
    {
      baseUrl: "http://127.0.0.1:18080",
      username: "user-a",
      password: "secret",
    },
    fetchImpl,
  );
  const result = await client.exportNote({ markdown: "正文" });

  assert.equal(result.action, "created");
  const postCall = calls.find((call) => call.method === "POST");
  assert.ok(postCall);
  const getCall = calls.find(
    (call) => call.method === "GET" && call.pathname === "/api/workspace",
  );
  assert.ok(getCall);
});

test("exportNote：按 note_id 更新内容与可选属性", async () => {
  const { fetchImpl, calls } = createMockFetch((method, pathname) => {
    if (method === "GET" && pathname === "/api/workspace") {
      return { status: 200, body: { updatedAt: 10, workspace: sampleWorkspace() } };
    }
    if (method === "PUT" && pathname === "/api/workspace") {
      return { status: 200, body: { updatedAt: 11, workspace: null } };
    }
    return { status: 404, body: { error: "unexpected route" } };
  });

  const client = new NotesClient(
    { baseUrl: "http://127.0.0.1:18080", token: "notes_sk_v1.test" },
    fetchImpl,
  );
  const result = await client.exportNote({
    markdown: "# 更新后的标题\n\n新内容",
    noteId: "note-existing",
    starred: true,
    folder: "工作",
  });

  assert.equal(result.action, "updated");
  assert.equal(result.noteId, "note-existing");
  assert.equal(result.title, "更新后的标题");

  const putCall = calls.find((call) => call.method === "PUT");
  assert.ok(putCall);
  const body = putCall.body as { workspace: NoteWorkspace };
  const updated = body.workspace.notes.find((note) => note.id === "note-existing");
  assert.ok(updated);
  assert.equal(updated.markdown, "# 更新后的标题\n\n新内容");
  assert.equal(updated.isStarred, true);
  assert.equal(updated.folderId, "folder-1");
  assert.equal(body.workspace.notes.length, 1);
});

test("exportNote：409 冲突自动重读重试", async () => {
  let putAttempts = 0;
  const { fetchImpl, calls } = createMockFetch((method, pathname) => {
    if (method === "GET" && pathname === "/api/workspace") {
      return putAttempts === 0
        ? { status: 200, body: { updatedAt: 10, workspace: sampleWorkspace() } }
        : { status: 200, body: { updatedAt: 12, workspace: sampleWorkspace() } };
    }
    if (method === "PUT" && pathname === "/api/workspace") {
      putAttempts += 1;
      if (putAttempts === 1) {
        return { status: 409, body: { error: "工作区已被其他端修改。" } };
      }
      return { status: 200, body: { updatedAt: 13, workspace: null } };
    }
    return { status: 404, body: { error: "unexpected route" } };
  });

  const client = new NotesClient(
    { baseUrl: "http://127.0.0.1:18080", token: "notes_sk_v1.test" },
    fetchImpl,
  );
  const result = await client.exportNote({ markdown: "正文" });

  assert.equal(result.action, "created");
  assert.equal(putAttempts, 2);
  const getCalls = calls.filter(
    (call) => call.method === "GET" && call.pathname === "/api/workspace",
  );
  assert.equal(getCalls.length, 2);
  const secondPut = calls.filter((call) => call.method === "PUT")[1];
  const secondBody = secondPut.body as { expectedUpdatedAt: number | null };
  assert.equal(secondBody.expectedUpdatedAt, 12);
});

test("exportNote：空内容、未知 note_id、缺认证分别报错", async () => {
  const { fetchImpl } = createMockFetch((method, pathname) => {
    if (method === "GET" && pathname === "/api/workspace") {
      return { status: 200, body: { updatedAt: 10, workspace: sampleWorkspace() } };
    }
    return { status: 404, body: { error: "unexpected route" } };
  });

  const client = new NotesClient(
    { baseUrl: "http://127.0.0.1:18080", token: "notes_sk_v1.test" },
    fetchImpl,
  );
  await assert.rejects(
    client.exportNote({ markdown: "   " }),
    /不能为空/,
  );
  await assert.rejects(
    client.exportNote({ markdown: "正文", noteId: "missing-id" }),
    /未找到便签/,
  );

  const unauthenticated = new NotesClient(
    { baseUrl: "http://127.0.0.1:18080" },
    fetchImpl,
  );
  await assert.rejects(
    unauthenticated.exportNote({ markdown: "正文" }),
    /缺少认证信息/,
  );
});

test("exportImage：匿名导出调用 /api/export 并返回 PNG 字节与 URL", async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const { fetchImpl, calls } = createMockFetch((method, pathname, init) => {
    assert.equal(method, "POST");
    assert.equal(pathname, "/api/export");
    assert.deepEqual(
      JSON.parse(String(init.body)) as Record<string, string>,
      { markdown: "正文", theme: "smartisan-dark", filename: "对话.png" },
    );
    const response = new Response(pngBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "X-Export-Url": "https://demo.example.com/images/export-1.png",
        "X-Export-Theme": "smartisan-dark",
      },
    });
    return { response };
  });

  const client = new NotesClient(
    { baseUrl: "https://demo.example.com" },
    fetchImpl,
  );
  const result = await client.exportImage({
    markdown: "正文",
    theme: "smartisan-dark",
    filename: "对话.png",
  });

  assert.deepEqual(result.png, pngBytes);
  assert.equal(result.url, "https://demo.example.com/images/export-1.png");
  assert.equal(result.theme, "smartisan-dark");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].pathname, "/api/export");
});

test("exportImage：空内容与非 2xx 响应报错", async () => {
  const { fetchImpl } = createMockFetch((_method, _pathname) => {
    return { status: 502, body: { error: "上游渲染失败。" } };
  });

  const client = new NotesClient(
    { baseUrl: "https://demo.example.com" },
    fetchImpl,
  );
  await assert.rejects(
    client.exportImage({ markdown: "  " }),
    /不能为空/,
  );
  await assert.rejects(
    client.exportImage({ markdown: "正文" }),
    (error: unknown) =>
      error instanceof NotesApiError &&
      error.status === 502 &&
      /上游渲染失败/.test(error.message),
  );
});

test("savePngToTempFile：写入临时目录并返回绝对路径", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const filePath = await savePngToTempFile(png, "对话记录");
  const directory = path.dirname(filePath);
  try {
    await access(filePath);
    assert.ok(filePath.startsWith(tmpdir()));
    assert.match(filePath, /dsh-notes-/);
    assert.match(filePath, /对话记录.*\.png$/);
    assert.deepEqual(await readFile(filePath), Buffer.from(png));
    if (process.platform !== "win32") {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
