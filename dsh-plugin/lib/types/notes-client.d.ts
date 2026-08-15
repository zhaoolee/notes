import type { ExportResult, ImageExportResult, NoteWorkspace, NotesServiceConfig } from "./types.js";
/** 未配置便签服务时回退的默认演示服务器。 */
export declare const DEFAULT_DEMO_SERVER = "https://notes.fangyuanxiaozhan.com";
/** 服务端返回的业务错误（HTTP 非 2xx 或缺少必需字段）。 */
export declare class NotesApiError extends Error {
    readonly status: number | null;
    readonly payload: unknown;
    constructor(message: string, status?: number | null, payload?: unknown);
}
/**
 * 只读取用户显式配置的便签服务地址（插件 config → 环境变量），未配置返回
 * undefined 且不报错——调用方据此选择「写入便签」还是「匿名导出图片」。
 */
export declare function readConfiguredBaseUrl(explicit?: Partial<NotesServiceConfig>): string | undefined;
/** 未配置 baseUrl 时使用的默认演示服务器（config → 环境变量 → 内置默认值）。 */
export declare function resolveDemoServer(explicit?: Partial<NotesServiceConfig>): string;
/**
 * 合并显式配置与进程环境变量，用于「写入便签」模式。baseUrl 缺失时直接报错，
 * 不得探测本地端口，也不得回退到任何公网服务。
 */
export declare function resolveServiceConfig(explicit?: Partial<NotesServiceConfig>): NotesServiceConfig;
/** 从 markdown 提取便签标题，规则与 notes_api.mjs 的 getNoteTitle 一致。 */
export declare function extractNoteTitle(markdown: string): string;
/** 便签前端链接（与 src/lib/note-route.ts 的 hash 路由一致）。 */
export declare function buildNoteUrl(baseUrl: string, noteId: string): string;
/** 把文件夹参数解析为 folderId；"none/null/未分类" 表示清除分类。 */
export declare function resolveFolderId(workspace: NoteWorkspace, value: string): string | null;
export interface ExportNoteInput {
    markdown: string;
    noteId?: string;
    folder?: string;
    starred?: boolean;
    pinned?: boolean;
}
export interface ExportImageInput {
    markdown: string;
    theme?: string;
    filename?: string;
}
/** 把 PNG 字节写入临时目录并返回绝对路径（图片模式输出）。 */
export declare function savePngToTempFile(png: Uint8Array, title: string): Promise<string>;
export declare class NotesClient {
    readonly baseUrl: string;
    private readonly fetchImpl;
    private tokenPromise;
    private readonly config;
    constructor(config: NotesServiceConfig, fetchImpl?: typeof fetch);
    private readResponsePayload;
    private apiJson;
    /** 用用户名/密码向 /api/auth/skill-token 申请稳定 Token（仅内存，不落盘）。 */
    private requestSkillToken;
    /** 解析可用 Token：显式 Token 优先，否则用账号密码申请并缓存。 */
    resolveToken(signal?: AbortSignal): Promise<string>;
    private loadWorkspace;
    private saveWorkspace;
    /**
     * 把对话内容导出为便签：新增或按 noteId 更新。读改写遇到 409 时自动重读
     * 并重试，最多 4 次，不盲目覆盖整个工作区。
     */
    exportNote(input: ExportNoteInput, signal?: AbortSignal): Promise<ExportResult>;
    /**
     * 通过匿名导出接口把 Markdown 渲染为锤子便签长图 PNG（无需登录）。
     * 返回 PNG 字节与服务器上的公开 URL（X-Export-Url 响应头）。
     */
    exportImage(input: ExportImageInput, signal?: AbortSignal): Promise<ImageExportResult>;
}
