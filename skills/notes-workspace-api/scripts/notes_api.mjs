#!/usr/bin/env node

// Manage authenticated note workspaces through the same self-hosted API.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const MAX_MUTATION_ATTEMPTS = 4;
const BOOLEAN_OPTIONS = new Set([
  "help",
  "include-markdown",
  "permanent",
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

async function readEnvFile(filename, { required = false } = {}) {
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
      if (required) {
        throw new Error(`配置文件不存在：${filename}`);
      }

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

async function resolveConfig(options) {
  const explicitEnvPath = options["env-file"]
    ? path.resolve(String(options["env-file"]))
    : null;
  const skillEnvPath = path.join(SKILL_DIR, ".env");
  const explicitEnv = explicitEnvPath
    ? await readEnvFile(explicitEnvPath, {
        required: true,
      })
    : {};
  const skillEnv = await readEnvFile(skillEnvPath);
  const getConfigValue = (key) =>
    firstNonEmpty(explicitEnv[key], process.env[key], skillEnv[key]);
  const configuredBaseUrl = firstNonEmpty(
    options["base-url"],
    getConfigValue("NOTES_API_BASE_URL"),
  );

  if (!configuredBaseUrl) {
    throw new Error(
      "缺少服务地址。请在 .env 中设置 NOTES_API_BASE_URL，或显式传入 --base-url。",
    );
  }

  const baseUrl = normalizeBaseUrl(configuredBaseUrl);
  const token = firstNonEmpty(
    options.token,
    getConfigValue("NOTES_API_TOKEN"),
  );
  const username = firstNonEmpty(
    options.username,
    getConfigValue("NOTES_API_USERNAME"),
  );
  const password = firstNonEmpty(
    options.password,
    getConfigValue("NOTES_API_PASSWORD"),
  );

  if (!token && (!username || !password)) {
    throw new Error(
      "缺少认证信息。请设置 NOTES_API_TOKEN，或在 .env 中提供 NOTES_API_USERNAME/NOTES_API_PASSWORD 以自动生成 Token。",
    );
  }

  return {
    baseUrl,
    envFilePath:
      explicitEnvPath ?? (Object.keys(skillEnv).length > 0 ? skillEnvPath : null),
    password,
    token,
    username,
  };
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

async function requestSkillToken(config) {
  const response = await fetch(`${config.baseUrl}/api/auth/skill-token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      password: config.password,
      username: config.username,
    }),
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : `Skill Token 申请失败（HTTP ${response.status}）`;
    throw new ApiError(String(message), response.status, payload);
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !("token" in payload) ||
    typeof payload.token !== "string" ||
    !payload.token.startsWith("notes_sk_v1.")
  ) {
    throw new Error("服务端未返回有效的 Skill Token。");
  }

  return payload.token;
}

async function persistSkillToken(config, token) {
  const filename = config.envFilePath;

  if (!filename) {
    return false;
  }

  const existing = await fs.readFile(filename, "utf8").catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
  const retainedLines = existing
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(?:export\s+)?NOTES_API_(?:BASE_URL|TOKEN|USERNAME|PASSWORD)\s*=/.test(
          line,
        ),
    );

  while (retainedLines.length > 0 && retainedLines.at(-1)?.trim() === "") {
    retainedLines.pop();
  }

  retainedLines.push(
    `NOTES_API_BASE_URL=${config.baseUrl}`,
    `NOTES_API_TOKEN=${token}`,
    "",
  );
  const temporaryPath = `${filename}.${process.pid}.${randomUUID()}.tmp`;

  await fs.mkdir(path.dirname(filename), { recursive: true });

  try {
    await fs.writeFile(temporaryPath, retainedLines.join("\n"), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, filename);
    await fs.chmod(filename, 0o600);
    return true;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function resolveSkillToken(config) {
  if (config.token) {
    return config.token;
  }

  const token = await requestSkillToken(config);

  try {
    if (await persistSkillToken(config, token)) {
      process.stderr.write(
        `${JSON.stringify({ info: "已生成 Skill Token，并从 .env 移除用户名和密码。" })}\n`,
      );
    }
  } catch {
    process.stderr.write(
      `${JSON.stringify({ warning: "Skill Token 已生成，但无法写入 .env；本次命令将继续使用内存中的 Token。" })}\n`,
    );
  }

  return token;
}

async function apiJson(config, token, pathname, init = {}) {
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
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
    throw new Error("回收站中的便签不能修改、分类、加星或置顶。");
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

function createWorkspaceNote(
  workspace,
  {
    folderId = null,
    isStarred = false,
    markdown = "",
    now = Date.now(),
    pinned = false,
  } = {},
) {
  const firstNormalOrder = workspace.notes.reduce(
    (smallest, note) => Math.min(smallest, note.normalOrder),
    0,
  );
  const newestPinnedAt = workspace.notes.reduce(
    (latest, note) => Math.max(latest, note.pinnedAt ?? 0),
    0,
  );

  return {
    id: randomUUID(),
    markdown,
    createdAt: now,
    updatedAt: now,
    normalOrder: firstNormalOrder - 1,
    pinnedAt: pinned ? Math.max(now, newestPinnedAt + 1) : null,
    folderId,
    isStarred,
    deletedAt: null,
  };
}

function addBlankLiveNote(workspace) {
  const note = createWorkspaceNote(workspace);
  workspace.activeNoteId = note.id;
  workspace.notes = [note, ...workspace.notes];
  return note;
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
    const note = createWorkspaceNote(workspace, {
      folderId: folder?.id ?? null,
      isStarred: starred,
      markdown,
      now,
      pinned,
    });

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

async function commandUpdate(config, cookie, options) {
  const noteId = requireStringOption(options, "note-id");
  const markdown = await readMarkdownOption(options);
  const result = await mutateWorkspace(config, cookie, (current) => {
    const workspace = requireWorkspace({ workspace: current });
    const note = requireMutableNote(workspace, noteId);

    if (note.markdown === markdown) {
      return {
        unchanged: true,
        value: presentNote(note, workspace),
      };
    }

    note.markdown = markdown;
    note.updatedAt = Date.now();
    return {
      select: (storedWorkspace) =>
        presentNote(requireNote(storedWorkspace, noteId), storedWorkspace),
      workspace,
    };
  });

  return { note: result.value, updatedAt: result.updatedAt };
}

async function commandDelete(config, cookie, options) {
  const noteId = requireStringOption(options, "note-id");
  const permanent = options.permanent === true;
  const result = await mutateWorkspace(config, cookie, (current) => {
    const workspace = requireWorkspace({ workspace: current });
    const note = requireNote(workspace, noteId);

    if (!permanent) {
      if (note.deletedAt !== null) {
        return {
          unchanged: true,
          value: presentNote(note, workspace),
        };
      }

      note.deletedAt = Date.now();
      note.pinnedAt = null;

      if (!workspace.notes.some((candidate) => candidate.deletedAt === null)) {
        addBlankLiveNote(workspace);
      } else if (workspace.activeNoteId === noteId) {
        workspace.activeNoteId = workspace.notes.find(
          (candidate) => candidate.deletedAt === null,
        ).id;
      }

      return {
        select: (storedWorkspace) =>
          presentNote(requireNote(storedWorkspace, noteId), storedWorkspace),
        workspace,
      };
    }

    if (note.deletedAt === null) {
      throw new Error(
        "永久删除只允许回收站中的便签。请先执行 delete 软删除，再显式传入 --permanent。",
      );
    }

    const noteIndex = workspace.notes.findIndex(
      (candidate) => candidate.id === noteId,
    );
    workspace.notes = workspace.notes.filter(
      (candidate) => candidate.id !== noteId,
    );

    if (!workspace.notes.some((candidate) => candidate.deletedAt === null)) {
      addBlankLiveNote(workspace);
    } else if (workspace.activeNoteId === noteId) {
      workspace.activeNoteId =
        workspace.notes.find((candidate) => candidate.deletedAt === null)?.id ??
        workspace.notes[
          Math.min(Math.max(noteIndex, 0), workspace.notes.length - 1)
        ].id;
    }

    return {
      select: (storedWorkspace) => ({
        activeNoteId: storedWorkspace.activeNoteId,
        id: noteId,
        permanent: true,
      }),
      workspace,
    };
  });

  return permanent
    ? { deleted: result.value, updatedAt: result.updatedAt }
    : { note: result.value, updatedAt: result.updatedAt };
}

async function commandRestore(config, cookie, options) {
  const noteId = requireStringOption(options, "note-id");
  const result = await mutateWorkspace(config, cookie, (current) => {
    const workspace = requireWorkspace({ workspace: current });
    const note = requireNote(workspace, noteId);

    if (note.deletedAt === null) {
      return {
        unchanged: true,
        value: presentNote(note, workspace),
      };
    }

    note.deletedAt = null;
    note.pinnedAt = null;
    return {
      select: (storedWorkspace) =>
        presentNote(requireNote(storedWorkspace, noteId), storedWorkspace),
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

function printUsage() {
  process.stdout.write(`便签管理 API

Usage:
  notes_api.mjs list [--category all|starred|trash|folder] [--query TEXT]
  notes_api.mjs get --note-id ID
  notes_api.mjs add (--markdown TEXT | --markdown-file PATH) [--folder NAME_OR_ID] [--starred] [--pinned]
  notes_api.mjs update --note-id ID (--markdown TEXT | --markdown-file PATH)
  notes_api.mjs delete --note-id ID [--permanent]
  notes_api.mjs restore --note-id ID
  notes_api.mjs folders
  notes_api.mjs folder-create --name NAME
  notes_api.mjs classify --note-id ID --folder NAME_OR_ID|none
  notes_api.mjs star --note-id ID [--state on|off|toggle]
  notes_api.mjs pin --note-id ID [--state on|off|toggle]

Global options:
  --base-url URL
  --env-file PATH
  --token TOKEN
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
  const token = await resolveSkillToken(config);
  const handlers = {
    add: commandAdd,
    classify: commandClassify,
    delete: commandDelete,
    "folder-create": commandFolderCreate,
    folders: commandFolders,
    get: commandGet,
    list: commandList,
    pin: commandPin,
    restore: commandRestore,
    star: commandStar,
    update: commandUpdate,
  };
  const handler = handlers[command];

  if (!handler) {
    throw new Error(`未知命令：${command}`);
  }

  const result = await handler(config, token, options);
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
