#!/usr/bin/env node

// Manage authenticated note workspaces through the same self-hosted API.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const PROJECT_ROOT = path.resolve(SKILL_DIR, "../..");
const LOCAL_BASE_URL = "http://127.0.0.1:18080";
const REMOTE_BASE_URL = "https://notes.fangyuanxiaozhan.com";
const MAX_MUTATION_ATTEMPTS = 4;
const BOOLEAN_OPTIONS = new Set([
  "help",
  "include-markdown",
  "pinned",
  "starred",
]);

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function parseArguments(argv) {
  const [command = "", ...tokens] = argv;
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith("--")) {
      throw new Error(`无法识别的位置参数：${token}`);
    }

    const equalIndex = token.indexOf("=");
    const key =
      equalIndex === -1 ? token.slice(2) : token.slice(2, equalIndex);

    if (!key) {
      throw new Error("参数名称不能为空。");
    }

    if (equalIndex !== -1) {
      options[key] = token.slice(equalIndex + 1);
      continue;
    }

    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }

    const value = tokens[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`参数 --${key} 缺少值。`);
    }

    options[key] = value;
    index += 1;
  }

  return { command, options };
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function readEnvFile(filename) {
  try {
    const content = await fs.readFile(filename, "utf8");
    const values = {};

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const normalized = line.startsWith("export ")
        ? line.slice("export ".length)
        : line;
      const separatorIndex = normalized.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      const key = normalized.slice(0, separatorIndex).trim();
      const value = normalized.slice(separatorIndex + 1);

      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        values[key] = unquoteEnvValue(value);
      }
    }

    return values;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function firstNonEmpty(...values) {
  return values.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/api(?:\/.*)?$/, "").replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

async function isHealthy(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveConfig(options) {
  const explicitEnv = options["env-file"]
    ? await readEnvFile(path.resolve(String(options["env-file"])))
    : {};
  const skillEnv = await readEnvFile(path.join(SKILL_DIR, ".env"));
  const projectEnv = await readEnvFile(path.join(PROJECT_ROOT, ".env"));
  const getConfigValue = (key) =>
    firstNonEmpty(
      process.env[key],
      explicitEnv[key],
      skillEnv[key],
      projectEnv[key],
    );
  const configuredBaseUrl = firstNonEmpty(
    options["base-url"],
    getConfigValue("NOTES_API_BASE_URL"),
  );
  const baseUrl = configuredBaseUrl
    ? normalizeBaseUrl(configuredBaseUrl)
    : (await isHealthy(LOCAL_BASE_URL))
      ? LOCAL_BASE_URL
      : REMOTE_BASE_URL;
  const username = firstNonEmpty(
    options.username,
    getConfigValue("NOTES_API_USERNAME"),
    getConfigValue("SUPERADMIN"),
  );
  const password = firstNonEmpty(
    options.password,
    getConfigValue("NOTES_API_PASSWORD"),
    getConfigValue("SUPERADMINPASSWORD"),
  );

  if (!username || !password) {
    throw new Error(
      "缺少账号凭据。请设置 NOTES_API_USERNAME/NOTES_API_PASSWORD，或在项目 .env 中配置 SUPERADMIN/SUPERADMINPASSWORD。",
    );
  }

  return { baseUrl, password, username };
}

async function readResponsePayload(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function login(config) {
  const response = await fetch(`${config.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      password: config.password,
      remember: false,
      username: config.username,
    }),
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : `登录失败（HTTP ${response.status}）`;
    throw new ApiError(String(message), response.status, payload);
  }

  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error("登录成功但服务端未返回会话 Cookie。");
  }

  return {
    cookie: setCookie.split(";")[0],
    user: payload.user,
  };
}

async function apiJson(config, cookie, pathname, init = {}) {
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Cookie: cookie,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : `API 请求失败（HTTP ${response.status}）`;
    throw new ApiError(String(message), response.status, payload);
  }

  return payload;
}

async function loadWorkspace(config, cookie) {
  const payload = await apiJson(config, cookie, "/api/workspace");
  return {
    updatedAt: payload.updatedAt ?? null,
    workspace: payload.workspace ?? null,
  };
}

function requireWorkspace(loaded) {
  if (!loaded.workspace) {
    throw new Error("当前账号还没有云端工作区。请先新增一张便签。");
  }

  return loaded.workspace;
}

function requireStringOption(options, key) {
  const value = options[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`请提供 --${key}。`);
  }

  return value.trim();
}

function requireNote(workspace, noteId) {
  const note = workspace.notes.find((candidate) => candidate.id === noteId);

  if (!note) {
    throw new Error(`未找到便签：${noteId}`);
  }

  return note;
}

function requireMutableNote(workspace, noteId) {
  const note = requireNote(workspace, noteId);

  if (note.deletedAt !== null) {
    throw new Error("回收站中的便签不能分类、加星或置顶。");
  }

  return note;
}

function resolveFolder(workspace, value, allowNone = true) {
  const normalized = String(value).trim();

  if (
    allowNone &&
    ["none", "null", "未分类"].includes(normalized.toLocaleLowerCase("zh-CN"))
  ) {
    return null;
  }

  const folder = workspace.folders.find(
    (candidate) =>
      candidate.id === normalized ||
      candidate.name.toLocaleLowerCase("zh-CN") ===
        normalized.toLocaleLowerCase("zh-CN"),
  );

  if (!folder) {
    throw new Error(`未找到文件夹分类：${normalized}`);
  }

  return folder;
}

function getNoteTitle(markdown) {
  const line = markdown
    .split(/\r?\n/)
    .map((value) =>
      value
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s*/, "")
        .replace(/^[-+*]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/[`*_~]/g, "")
        .trim(),
    )
    .find(Boolean);
  const title = line || "新便签";
  return title.length <= 38 ? title : `${title.slice(0, 37).trimEnd()}…`;
}

function getNotePreview(markdown) {
  const lines = markdown
    .split(/\r?\n/)
    .map((value) => value.replace(/[#>*_`~[\]()!-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const preview = (lines.length > 1 ? lines.slice(1) : lines).join(" ") || "点击开始记录";
  return preview.length <= 88
    ? preview
    : `${preview.slice(0, 87).trimEnd()}…`;
}

function orderNotes(notes) {
  return notes
    .map((note, index) => ({ index, note }))
    .sort((left, right) => {
      const leftPinned = left.note.pinnedAt !== null;
      const rightPinned = right.note.pinnedAt !== null;

      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }

      if (leftPinned && rightPinned) {
        const difference =
          (right.note.pinnedAt ?? 0) - (left.note.pinnedAt ?? 0);

        if (difference !== 0) {
          return difference;
        }
      } else {
        const difference = left.note.normalOrder - right.note.normalOrder;

        if (difference !== 0) {
          return difference;
        }
      }

      return left.index - right.index;
    })
    .map(({ note }) => note);
}

function presentNote(note, workspace, includeMarkdown = true) {
  const folder = note.folderId
    ? workspace.folders.find((candidate) => candidate.id === note.folderId)
    : null;
  const presented = {
    id: note.id,
    title: getNoteTitle(note.markdown),
    preview: getNotePreview(note.markdown),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    normalOrder: note.normalOrder,
    pinnedAt: note.pinnedAt,
    isPinned: note.pinnedAt !== null,
    folderId: note.folderId,
    folderName: folder?.name ?? null,
    isStarred: note.isStarred,
    deletedAt: note.deletedAt,
  };

  if (includeMarkdown) {
    presented.markdown = note.markdown;
  }

  return presented;
}

function parseState(value) {
  const normalized = String(value ?? "on").toLocaleLowerCase();

  if (!["on", "off", "toggle"].includes(normalized)) {
    throw new Error("--state 只接受 on、off 或 toggle。");
  }

  return normalized;
}

function resolveBooleanState(current, state) {
  if (state === "toggle") {
    return !current;
  }

  return state === "on";
}

async function mutateWorkspace(config, cookie, transform) {
  for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
    const loaded = await loadWorkspace(config, cookie);
    const outcome = transform(
      loaded.workspace ? structuredClone(loaded.workspace) : null,
    );

    if (outcome.unchanged) {
      return {
        updatedAt: loaded.updatedAt,
        value: outcome.value,
        workspace: loaded.workspace,
      };
    }

    try {
      const stored = await apiJson(config, cookie, "/api/workspace", {
        method: "PUT",
        body: JSON.stringify({
          expectedUpdatedAt: loaded.updatedAt,
          workspace: outcome.workspace,
        }),
      });
      return {
        updatedAt: stored.updatedAt,
        value: outcome.select
          ? outcome.select(stored.workspace)
          : outcome.value,
        workspace: stored.workspace,
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        attempt < MAX_MUTATION_ATTEMPTS
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("工作区在连续重试期间一直变化，请稍后再试。");
}

async function commandList(config, cookie, options) {
  const loaded = await loadWorkspace(config, cookie);

  if (!loaded.workspace) {
    return {
      category: options.category ?? "all",
      notes: [],
      offset: 0,
      returned: 0,
      total: 0,
      updatedAt: loaded.updatedAt,
    };
  }

  const workspace = loaded.workspace;
  const requestedCategory = String(options.category ?? "all").trim();
  let category = requestedCategory;
  let notes = workspace.notes;

  if (requestedCategory === "trash") {
    notes = notes.filter((note) => note.deletedAt !== null);
  } else {
    notes = notes.filter((note) => note.deletedAt === null);

    if (requestedCategory === "starred") {
      notes = notes.filter((note) => note.isStarred);
    } else if (requestedCategory !== "all") {
      const requestedFolder = requestedCategory.startsWith("folder:")
        ? requestedCategory.slice("folder:".length)
        : requestedCategory;
      const folder = resolveFolder(workspace, requestedFolder, false);
      category = `folder:${folder.id}`;
      notes = notes.filter((note) => note.folderId === folder.id);
    }
  }

  const query = String(options.query ?? "").trim().toLocaleLowerCase("zh-CN");

  if (query) {
    notes = notes.filter((note) =>
      note.markdown.toLocaleLowerCase("zh-CN").includes(query),
    );
  }

  notes = orderNotes(notes);
  const offset = Math.max(0, Number.parseInt(String(options.offset ?? "0"), 10));
  const requestedLimit = Number.parseInt(String(options.limit ?? "50"), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(500, Math.max(1, requestedLimit))
    : 50;

  return {
    category,
    limit,
    notes: notes
      .slice(offset, offset + limit)
      .map((note) => presentNote(note, workspace, options["include-markdown"] === true)),
    offset,
    returned: Math.min(limit, Math.max(0, notes.length - offset)),
    total: notes.length,
    updatedAt: loaded.updatedAt,
  };
}

async function commandGet(config, cookie, options) {
  const loaded = await loadWorkspace(config, cookie);
  const workspace = requireWorkspace(loaded);
  const noteId = requireStringOption(options, "note-id");
  return {
    note: presentNote(requireNote(workspace, noteId), workspace),
    updatedAt: loaded.updatedAt,
  };
}

async function readMarkdownOption(options) {
  const inlineMarkdown = options.markdown;
  const markdownFile = options["markdown-file"];

  if (
    typeof inlineMarkdown === "string" &&
    typeof markdownFile === "string"
  ) {
    throw new Error("--markdown 和 --markdown-file 只能使用一个。");
  }

  if (typeof markdownFile === "string") {
    return fs.readFile(path.resolve(markdownFile), "utf8");
  }

  if (typeof inlineMarkdown === "string") {
    return inlineMarkdown;
  }

  throw new Error("请提供 --markdown 或 --markdown-file。");
}

async function commandAdd(config, cookie, options) {
  const markdown = await readMarkdownOption(options);
  const starred = options.starred === true;
  const pinned = options.pinned === true;
  const result = await mutateWorkspace(config, cookie, (current) => {
    const now = Date.now();
    const workspace =
      current ??
      ({
        activeNoteId: "",
        folders: [],
        notes: [],
        version: 1,
      });
    const folderOption = options.folder;
    const folder =
      folderOption === undefined
        ? null
        : resolveFolder(workspace, folderOption, true);
    const firstNormalOrder = workspace.notes.reduce(
      (smallest, note) => Math.min(smallest, note.normalOrder),
      0,
    );
    const newestPinnedAt = workspace.notes.reduce(
      (latest, note) => Math.max(latest, note.pinnedAt ?? 0),
      0,
    );
    const note = {
      id: randomUUID(),
      markdown,
      createdAt: now,
      updatedAt: now,
      normalOrder: firstNormalOrder - 1,
      pinnedAt: pinned ? Math.max(now, newestPinnedAt + 1) : null,
      folderId: folder?.id ?? null,
      isStarred: starred,
      deletedAt: null,
    };

    workspace.activeNoteId = note.id;
    workspace.notes = [note, ...workspace.notes];

    return {
      select: (storedWorkspace) =>
        presentNote(requireNote(storedWorkspace, note.id), storedWorkspace),
      workspace,
    };
  });

  return { note: result.value, updatedAt: result.updatedAt };
}

async function commandFolders(config, cookie) {
  const loaded = await loadWorkspace(config, cookie);

  if (!loaded.workspace) {
    return {
      folders: [],
      unfiledCount: 0,
      updatedAt: loaded.updatedAt,
    };
  }

  const workspace = loaded.workspace;
  const liveNotes = workspace.notes.filter((note) => note.deletedAt === null);

  return {
    folders: workspace.folders.map((folder) => ({
      ...folder,
      noteCount: liveNotes.filter((note) => note.folderId === folder.id).length,
    })),
    unfiledCount: liveNotes.filter((note) => note.folderId === null).length,
    updatedAt: loaded.updatedAt,
  };
}

async function commandFolderCreate(config, cookie, options) {
  const name = requireStringOption(options, "name");
  const result = await mutateWorkspace(config, cookie, (current) => {
    if (!current) {
      throw new Error("当前账号还没有云端工作区。请先新增一张便签。");
    }

    const existing = current.folders.find(
      (folder) =>
        folder.name.toLocaleLowerCase("zh-CN") ===
        name.toLocaleLowerCase("zh-CN"),
    );

    if (existing) {
      return { unchanged: true, value: existing };
    }

    const folder = {
      id: randomUUID(),
      name,
      createdAt: Date.now(),
    };
    current.folders = [...current.folders, folder];

    return {
      select: (storedWorkspace) =>
        storedWorkspace.folders.find(
          (candidate) => candidate.id === folder.id,
        ),
      workspace: current,
    };
  });

  return { folder: result.value, updatedAt: result.updatedAt };
}

async function commandClassify(config, cookie, options) {
  const noteId = requireStringOption(options, "note-id");
  const folderOption = requireStringOption(options, "folder");
  const result = await mutateWorkspace(config, cookie, (current) => {
    const workspace = requireWorkspace({ workspace: current });
    const note = requireMutableNote(workspace, noteId);
    const folder = resolveFolder(workspace, folderOption, true);
    const folderId = folder?.id ?? null;

    if (note.folderId === folderId) {
      return {
        unchanged: true,
        value: presentNote(note, workspace),
      };
    }

    note.folderId = folderId;
    return {
      select: (storedWorkspace) =>
        presentNote(requireNote(storedWorkspace, noteId), storedWorkspace),
      workspace,
    };
  });

  return { note: result.value, updatedAt: result.updatedAt };
}

async function commandStar(config, cookie, options) {
  const noteId = requireStringOption(options, "note-id");
  const state = parseState(options.state);
  const result = await mutateWorkspace(config, cookie, (current) => {
    const workspace = requireWorkspace({ workspace: current });
    const note = requireMutableNote(workspace, noteId);
    const isStarred = resolveBooleanState(note.isStarred, state);

    if (note.isStarred === isStarred) {
      return {
        unchanged: true,
        value: presentNote(note, workspace),
      };
    }

    note.isStarred = isStarred;
    return {
      select: (storedWorkspace) =>
        presentNote(requireNote(storedWorkspace, noteId), storedWorkspace),
      workspace,
    };
  });

  return { note: result.value, updatedAt: result.updatedAt };
}

async function commandPin(config, cookie, options) {
  const noteId = requireStringOption(options, "note-id");
  const state = parseState(options.state);
  const result = await mutateWorkspace(config, cookie, (current) => {
    const workspace = requireWorkspace({ workspace: current });
    const note = requireMutableNote(workspace, noteId);
    const shouldPin = resolveBooleanState(note.pinnedAt !== null, state);

    if ((note.pinnedAt !== null) === shouldPin) {
      return {
        unchanged: true,
        value: presentNote(note, workspace),
      };
    }

    if (!shouldPin) {
      note.pinnedAt = null;
    } else {
      const newestPinnedAt = workspace.notes.reduce(
        (latest, candidate) =>
          Math.max(latest, candidate.pinnedAt ?? 0),
        0,
      );
      note.pinnedAt = Math.max(Date.now(), newestPinnedAt + 1);
    }

    return {
      select: (storedWorkspace) =>
        presentNote(requireNote(storedWorkspace, noteId), storedWorkspace),
      workspace,
    };
  });

  return { note: result.value, updatedAt: result.updatedAt };
}

async function commandWechat(config, cookie, options) {
  const loaded = await loadWorkspace(config, cookie);
  const workspace = requireWorkspace(loaded);
  const noteId = requireStringOption(options, "note-id");
  const note = requireNote(workspace, noteId);
  const payload = await apiJson(config, cookie, "/api/wechat", {
    method: "POST",
    body: JSON.stringify({ markdown: note.markdown }),
  });
  const output = {
    noteId,
    title: getNoteTitle(note.markdown),
    ...payload,
  };

  if (typeof options["output-html"] === "string") {
    const outputPath = path.resolve(options["output-html"]);
    await fs.writeFile(outputPath, output.html, "utf8");
    delete output.html;
    output.htmlPath = outputPath;
  }

  if (typeof options["output-markdown"] === "string") {
    const outputPath = path.resolve(options["output-markdown"]);
    await fs.writeFile(outputPath, output.markdown, "utf8");
    delete output.markdown;
    output.markdownPath = outputPath;
  }

  return output;
}

function printUsage() {
  process.stdout.write(`便签管理 API

Usage:
  notes_api.mjs list [--category all|starred|trash|folder] [--query TEXT]
  notes_api.mjs get --note-id ID
  notes_api.mjs add (--markdown TEXT | --markdown-file PATH) [--folder NAME_OR_ID] [--starred] [--pinned]
  notes_api.mjs folders
  notes_api.mjs folder-create --name NAME
  notes_api.mjs classify --note-id ID --folder NAME_OR_ID|none
  notes_api.mjs star --note-id ID [--state on|off|toggle]
  notes_api.mjs pin --note-id ID [--state on|off|toggle]
  notes_api.mjs wechat --note-id ID [--output-html PATH] [--output-markdown PATH]

Global options:
  --base-url URL
  --env-file PATH
  --username USERNAME
  --password PASSWORD
`);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));

  if (!command || command === "help" || options.help) {
    printUsage();
    return;
  }

  const config = await resolveConfig(options);
  const session = await login(config);
  const handlers = {
    add: commandAdd,
    classify: commandClassify,
    "folder-create": commandFolderCreate,
    folders: commandFolders,
    get: commandGet,
    list: commandList,
    pin: commandPin,
    star: commandStar,
    wechat: commandWechat,
  };
  const handler = handlers[command];

  if (!handler) {
    throw new Error(`未知命令：${command}`);
  }

  const result = await handler(config, session.cookie, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  const payload = {
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof ApiError ? { status: error.status } : {}),
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
