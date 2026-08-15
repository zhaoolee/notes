/** 与便签服务工作区模型保持一致的单张便签。 */
export interface NoteDocument {
    id: string;
    markdown: string;
    createdAt: number;
    updatedAt: number;
    normalOrder: number;
    pinnedAt: number | null;
    folderId: string | null;
    isStarred: boolean;
    deletedAt: number | null;
}
export interface NoteFolder {
    id: string;
    name: string;
    createdAt: number;
}
export interface NoteWorkspace {
    activeNoteId: string;
    folders: NoteFolder[];
    notes: NoteDocument[];
    version: 1;
}
/** `GET /api/workspace` 的响应。 */
export interface WorkspacePayload {
    updatedAt: number | null;
    workspace: NoteWorkspace | null;
}
/** `PUT /api/workspace` 的请求体。 */
export interface SaveWorkspaceBody {
    expectedUpdatedAt: number | null;
    workspace: NoteWorkspace;
}
/** 插件读取到的服务配置。 */
export interface NotesServiceConfig {
    baseUrl?: string;
    token?: string;
    username?: string;
    password?: string;
    /** 未配置 baseUrl 时回退的默认演示服务器（默认 https://notes.fangyuanxiaozhan.com）。 */
    demoServer?: string;
}
/** 匿名导出图片的返回。 */
export interface ImageExportResult {
    /** 渲染出的 PNG 字节。 */
    png: Uint8Array;
    /** 默认演示服务器上可访问的图片 URL（响应头 X-Export-Url），缺失时为 null。 */
    url: string | null;
    /** 实际使用的主题。 */
    theme: string;
}
/** 工具返回的规范结果（写入便签或匿名导出图片两种模式）。 */
export interface ExportResult {
    /** created/updated：写入了便签；exported-image：通过默认演示服务器匿名渲染为图片。 */
    action: "created" | "updated" | "exported-image";
    /** 写入模式下的便签 ID；图片模式为 null。 */
    noteId: string | null;
    title: string;
    /** 便签前端链接（写入模式）或导出图片 URL（图片模式）。 */
    url: string | null;
    /** 图片模式下本地保存的 PNG 绝对路径；写入模式为 null。 */
    filePath: string | null;
    /** 写入模式下的服务端更新时间戳；图片模式为 null。 */
    updatedAt: number | null;
    /** 实际使用的服务地址。 */
    server: string;
}
/**
 * 工具的规范输出（snake_case，与 defineTool 的输出 schema 一一对应）。
 * 与 ExportResult 同构，仅字段名按工具参数约定改为下划线。
 */
export interface ExportToolOutput {
    action: "created" | "updated" | "exported-image";
    note_id: string | null;
    title: string;
    url: string | null;
    file_path: string | null;
    updated_at: number | null;
    server: string;
}
