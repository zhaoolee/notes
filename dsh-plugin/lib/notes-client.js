// 便签服务 API 客户端：只依赖 Node 内置能力与全局 fetch，不 import 任何 dsh
// 包，保证可以脱离 DSH 环境在仓库 tsx 下独立测试。读写逻辑与
// skills/notes-export-api/scripts/notes_api.mjs 保持一致：Bearer Token、
// 整工作区读改写、expectedUpdatedAt 乐观并发、409 重试。
//
// 分级模式：配置了 baseUrl 走「写入便签列表」；未配置任何用户信息时，通过
// 默认演示服务器（notes.fangyuanxiaozhan.com）的匿名导出接口把对话渲染成
// 锤子便签长图 PNG，让未配置用户开箱即用尝鲜。
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const MAX_MUTATION_ATTEMPTS = 4;
/** 未配置便签服务时回退的默认演示服务器。 */
export const DEFAULT_DEMO_SERVER = "https://notes.fangyuanxiaozhan.com";
/** 服务端返回的业务错误（HTTP 非 2xx 或缺少必需字段）。 */
export class NotesApiError extends Error {
    status;
    payload;
    constructor(message, status = null, payload) {
        super(message);
        this.name = "NotesApiError";
        this.status = status;
        this.payload = payload;
    }
}
function readEnv(key) {
    const value = process.env[key]?.trim();
    return value ? value : undefined;
}
function normalizeBaseUrl(value) {
    const trimmed = value?.trim().replace(/\/+$/, "");
    return trimmed ? trimmed : undefined;
}
/**
 * 只读取用户显式配置的便签服务地址（插件 config → 环境变量），未配置返回
 * undefined 且不报错——调用方据此选择「写入便签」还是「匿名导出图片」。
 */
export function readConfiguredBaseUrl(explicit) {
    return normalizeBaseUrl(explicit?.baseUrl ?? readEnv("NOTES_API_BASE_URL"));
}
/** 未配置 baseUrl 时使用的默认演示服务器（config → 环境变量 → 内置默认值）。 */
export function resolveDemoServer(explicit) {
    return (normalizeBaseUrl(explicit?.demoServer ?? readEnv("NOTES_DEMO_SERVER")) ??
        DEFAULT_DEMO_SERVER);
}
/**
 * 合并显式配置与进程环境变量，用于「写入便签」模式。baseUrl 缺失时直接报错，
 * 不得探测本地端口，也不得回退到任何公网服务。
 */
export function resolveServiceConfig(explicit) {
    const baseUrl = readConfiguredBaseUrl(explicit);
    if (!baseUrl) {
        throw new NotesApiError("缺少便签服务地址。请设置 NOTES_API_BASE_URL（如 http://127.0.0.1:18080），" +
            "或在插件配置中提供 baseUrl。");
    }
    return {
        baseUrl,
        token: explicit?.token ?? readEnv("NOTES_API_TOKEN"),
        username: explicit?.username ?? readEnv("NOTES_API_USERNAME"),
        password: explicit?.password ?? readEnv("NOTES_API_PASSWORD"),
    };
}
/** 从 markdown 提取便签标题，规则与 notes_api.mjs 的 getNoteTitle 一致。 */
export function extractNoteTitle(markdown) {
    const line = markdown
        .split(/\r?\n/)
        .map((value) => value
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s*/, "")
        .replace(/^[-+*]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/[`*_~]/g, "")
        .trim())
        .find(Boolean);
    const title = line || "新便签";
    return title.length <= 38 ? title : `${title.slice(0, 37).trimEnd()}…`;
}
/** 便签前端链接（与 src/lib/note-route.ts 的 hash 路由一致）。 */
export function buildNoteUrl(baseUrl, noteId) {
    return `${baseUrl}/#note=${noteId}&view=preview`;
}
/** 把文件夹参数解析为 folderId；"none/null/未分类" 表示清除分类。 */
export function resolveFolderId(workspace, value) {
    const normalized = value.trim();
    if (["none", "null", "未分类"].includes(normalized.toLocaleLowerCase("zh-CN"))) {
        return null;
    }
    const folder = workspace.folders.find((candidate) => candidate.id === normalized ||
        candidate.name.toLocaleLowerCase("zh-CN") ===
            normalized.toLocaleLowerCase("zh-CN"));
    if (!folder) {
        throw new NotesApiError(`未找到文件夹分类：${normalized}`);
    }
    return folder.id;
}
/** 新建便签的对象形状，与 createWorkspaceNote 一致。 */
function createNoteDocument(workspace, options) {
    const firstNormalOrder = workspace.notes.reduce((smallest, note) => Math.min(smallest, note.normalOrder), 0);
    const newestPinnedAt = workspace.notes.reduce((latest, note) => Math.max(latest, note.pinnedAt ?? 0), 0);
    return {
        id: randomUUID(),
        markdown: options.markdown,
        createdAt: options.now,
        updatedAt: options.now,
        normalOrder: firstNormalOrder - 1,
        pinnedAt: options.pinned ? Math.max(options.now, newestPinnedAt + 1) : null,
        folderId: options.folderId,
        isStarred: options.isStarred,
        deletedAt: null,
    };
}
/** 把 PNG 字节写入临时目录并返回绝对路径（图片模式输出）。 */
export async function savePngToTempFile(png, title) {
    const safeTitle = title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "note";
    const directory = await mkdtemp(path.join(tmpdir(), "dsh-notes-"));
    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeTitle}.png`;
    const filePath = path.join(directory, filename);
    await writeFile(filePath, png, { flag: "wx", mode: 0o600 });
    return filePath;
}
export class NotesClient {
    baseUrl;
    fetchImpl;
    tokenPromise = null;
    config;
    constructor(config, fetchImpl = fetch) {
        this.config = config;
        this.baseUrl = config.baseUrl ?? "";
        this.fetchImpl = fetchImpl;
    }
    async readResponsePayload(response) {
        const text = await response.text();
        if (!text)
            return null;
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    async apiJson(token, pathname, init = {}, signal) {
        const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
            ...init,
            signal,
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
                ...(init.body ? { "Content-Type": "application/json" } : {}),
                ...init.headers,
            },
        });
        const payload = await this.readResponsePayload(response);
        if (!response.ok) {
            const message = payload && typeof payload === "object" && "error" in payload
                ? String(payload.error)
                : `API 请求失败（HTTP ${response.status}）`;
            throw new NotesApiError(message, response.status, payload);
        }
        return payload;
    }
    /** 用用户名/密码向 /api/auth/skill-token 申请稳定 Token（仅内存，不落盘）。 */
    async requestSkillToken(signal) {
        const response = await this.fetchImpl(`${this.baseUrl}/api/auth/skill-token`, {
            method: "POST",
            signal,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                password: this.config.password,
                username: this.config.username,
            }),
        });
        const payload = (await this.readResponsePayload(response));
        if (!response.ok) {
            const message = payload && typeof payload === "object" && "error" in payload
                ? String(payload.error)
                : `Skill Token 申请失败（HTTP ${response.status}）`;
            throw new NotesApiError(message, response.status, payload);
        }
        if (!payload ||
            typeof payload.token !== "string" ||
            !payload.token.startsWith("notes_sk_v1.")) {
            throw new NotesApiError("服务端未返回有效的 Skill Token。");
        }
        return payload.token;
    }
    /** 解析可用 Token：显式 Token 优先，否则用账号密码申请并缓存。 */
    resolveToken(signal) {
        if (this.config.token) {
            return Promise.resolve(this.config.token);
        }
        if (!this.config.username || !this.config.password) {
            return Promise.reject(new NotesApiError("缺少认证信息。请设置 NOTES_API_TOKEN，或提供 NOTES_API_USERNAME/" +
                "NOTES_API_PASSWORD 以自动申请 Token。"));
        }
        if (!this.tokenPromise) {
            this.tokenPromise = this.requestSkillToken(signal).catch((error) => {
                this.tokenPromise = null;
                throw error;
            });
        }
        return this.tokenPromise;
    }
    async loadWorkspace(token, signal) {
        return this.apiJson(token, "/api/workspace", {}, signal);
    }
    async saveWorkspace(token, expectedUpdatedAt, workspace, signal) {
        return this.apiJson(token, "/api/workspace", {
            method: "PUT",
            body: JSON.stringify({ expectedUpdatedAt, workspace }),
        }, signal);
    }
    /**
     * 把对话内容导出为便签：新增或按 noteId 更新。读改写遇到 409 时自动重读
     * 并重试，最多 4 次，不盲目覆盖整个工作区。
     */
    async exportNote(input, signal) {
        const markdown = input.markdown.trim();
        if (!markdown) {
            throw new NotesApiError("便签内容不能为空。");
        }
        const token = await this.resolveToken(signal);
        const now = Date.now();
        for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
            const loaded = await this.loadWorkspace(token, signal);
            const workspace = loaded.workspace ?? {
                activeNoteId: "",
                folders: [],
                notes: [],
                version: 1,
            };
            let noteId;
            let action;
            if (input.noteId) {
                const existing = workspace.notes.find((candidate) => candidate.id === input.noteId);
                if (!existing) {
                    throw new NotesApiError(`未找到便签：${input.noteId}`);
                }
                if (existing.deletedAt !== null) {
                    throw new NotesApiError("回收站中的便签不能修改。");
                }
                existing.markdown = markdown;
                existing.updatedAt = now;
                if (input.folder !== undefined) {
                    existing.folderId = resolveFolderId(workspace, input.folder);
                }
                if (input.starred !== undefined) {
                    existing.isStarred = input.starred;
                }
                if (input.pinned !== undefined) {
                    existing.pinnedAt = input.pinned ? now : null;
                }
                noteId = existing.id;
                action = "updated";
            }
            else {
                const folderId = input.folder === undefined
                    ? null
                    : resolveFolderId(workspace, input.folder);
                const note = createNoteDocument(workspace, {
                    folderId,
                    isStarred: input.starred === true,
                    markdown,
                    now,
                    pinned: input.pinned === true,
                });
                workspace.activeNoteId = note.id;
                workspace.notes = [note, ...workspace.notes];
                noteId = note.id;
                action = "created";
            }
            try {
                const stored = await this.saveWorkspace(token, loaded.updatedAt, workspace, signal);
                return {
                    action,
                    noteId,
                    title: extractNoteTitle(markdown),
                    url: buildNoteUrl(this.baseUrl, noteId),
                    filePath: null,
                    updatedAt: stored.updatedAt ?? now,
                    server: this.baseUrl,
                };
            }
            catch (error) {
                if (error instanceof NotesApiError &&
                    error.status === 409 &&
                    attempt < MAX_MUTATION_ATTEMPTS) {
                    continue;
                }
                throw error;
            }
        }
        throw new NotesApiError("工作区在连续重试期间一直变化，请稍后再试。");
    }
    /**
     * 通过匿名导出接口把 Markdown 渲染为锤子便签长图 PNG（无需登录）。
     * 返回 PNG 字节与服务器上的公开 URL（X-Export-Url 响应头）。
     */
    async exportImage(input, signal) {
        const markdown = input.markdown.trim();
        if (!markdown) {
            throw new NotesApiError("便签内容不能为空。");
        }
        const body = { markdown };
        if (input.theme) {
            body.theme = input.theme;
        }
        if (input.filename) {
            body.filename = input.filename;
        }
        const response = await this.fetchImpl(`${this.baseUrl}/api/export`, {
            method: "POST",
            signal,
            headers: {
                Accept: "image/png",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const payload = await this.readResponsePayload(response);
            const message = payload && typeof payload === "object" && "error" in payload
                ? String(payload.error)
                : `图片导出失败（HTTP ${response.status}）`;
            throw new NotesApiError(message, response.status, payload);
        }
        const png = new Uint8Array(await response.arrayBuffer());
        const url = response.headers.get("X-Export-Url");
        const theme = response.headers.get("X-Export-Theme") ?? input.theme ?? "default";
        return { png, url, theme };
    }
}
