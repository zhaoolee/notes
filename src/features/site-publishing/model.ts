import type { NoteDocument } from "../../types/app.js";
import { normalizeSiteLogoPath } from "./logo.js";

export const SITE_THEME_ID = "smartisan-blog" as const;
/** 新草稿的默认静态站点子路径；统一带首尾斜杠，保存过的设置仍以实际值为准。 */
export const DEFAULT_SITE_BASE_PATH = "/notes/";
/**
 * 可供选择的站点模板元数据。当前只有经典便签博客一种，面板按列表长度决定是否
 * 渲染“网站样式”选择区；以后接入第二种模板时只需在此追加条目。
 */
export interface SiteThemeOption {
  id: string;
  label: string;
  description: string;
}
export const SITE_THEMES: readonly SiteThemeOption[] = [
  {
    id: SITE_THEME_ID,
    label: "经典便签博客",
    description: "暖色便签纸质感，包含分类列表、文章页和移动端阅读。",
  },
];
export interface SiteCategory { id: string; name: string; slug: string }
export interface SiteSettings {
  title: string;
  description: string;
  author: string;
  origin: string;
  basePath: string;
  /** 空串表示默认锤子图标；非空只允许本机图片导入接口生成的 /images/ 路径。 */
  logoPath: string;
  themeId: typeof SITE_THEME_ID;
}
export interface SiteSettingsInput {
  title?: unknown;
  description?: unknown;
  author?: unknown;
  origin?: unknown;
  basePath?: unknown;
  /** 仅用于兼容旧客户端与旧草稿；新数据只读写 basePath。 */
  rootPath?: unknown;
  /** 可缺失以兼容旧客户端与旧草稿；缺失时使用默认锤子图标。 */
  logoPath?: unknown;
  themeId?: unknown;
}
export interface SiteSelection { noteId: string; categoryId: string }
export interface SitePublishDraft {
  settings: SiteSettings;
  categories: SiteCategory[];
  selections: SiteSelection[];
}
export interface SitePublishAccountConfiguration {
  draft: SitePublishDraft;
  updatedAt: number;
}
export interface SiteExportNote {
  id: string;
  markdown: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  categoryId: string;
}
export interface SiteExportRequest {
  settings: SiteSettings;
  categories: SiteCategory[];
  notes: SiteExportNote[];
}
export const DEFAULT_SITE_CATEGORIES: readonly SiteCategory[] = [
  { id: "guides", name: "做法", slug: "guides" },
  { id: "software", name: "软件", slug: "software" },
  { id: "hardware", name: "硬件", slug: "hardware" },
  { id: "project", name: "项目", slug: "project" },
  { id: "log", name: "杂谈", slug: "log" },
];
const RESERVED_SLUGS = new Set(["search", "assets", "css", "js", "images", "pagefind", "categories", "tags", "public", "page"]);

export function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 160 || !/^[a-zA-Z0-9/_-]*$/.test(trimmed)) {
    throw new Error("basePath 只能包含英文字母、数字、短横线、下划线和斜杠，例如 /blog/。");
  }
  const segments = trimmed.split("/").filter(Boolean);
  return segments.length ? `/${segments.join("/")}/` : "/";
}

export function normalizeSiteSettings(value: SiteSettingsInput): SiteSettings {
  if (!value || typeof value !== "object") throw new Error("网站设置不正确。");
  const { title, description, author, origin: rawOrigin, themeId } = value;
  if (typeof title !== "string" || typeof description !== "string" || typeof author !== "string" || typeof rawOrigin !== "string") throw new Error("网站设置不正确。");
  // basePath 显式存在时优先（空串或非法值也保留给 UI 报错），只有完全缺失时才兼容旧 rootPath。
  const rawBasePath = value.basePath !== undefined ? value.basePath : value.rootPath;
  if (typeof rawBasePath !== "string") throw new Error("网站设置不正确。");
  if (!title.trim() || title.length > 100) throw new Error("网站名称应为 1–100 个字符。");
  if (description.length > 500 || author.length > 100) throw new Error("网站简介或作者名称过长。");
  if (themeId !== SITE_THEME_ID) throw new Error("不支持此网站样式。");
  const logoPath = normalizeSiteLogoPath(value.logoPath);
  const trimmedOrigin = rawOrigin.trim();
  let origin = "";
  if (trimmedOrigin) {
    let url: URL;
    try { url = new URL(trimmedOrigin); } catch { throw new Error("请填写完整的站点域名，例如 https://example.com；也可以留空按当前域名部署。"); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("站点域名只填写协议和域名，子路径请填写在 basePath 中。");
    }
    origin = url.origin;
  }
  return { title: title.trim(), description: description.trim(), author: author.trim(), origin, basePath: normalizeBasePath(rawBasePath), logoPath, themeId: SITE_THEME_ID };
}

export function validateSiteCategories(value: SiteCategory[]): SiteCategory[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new Error("网站需要 1–30 个分类。");
  const ids = new Set<string>();
  const slugs = new Set<string>();
  return value.map((category) => {
    if (!category || typeof category.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(category.id) || typeof category.name !== "string" || !category.name.trim() || category.name.length > 30 || typeof category.slug !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(category.slug) || RESERVED_SLUGS.has(category.slug)) {
      throw new Error("分类名称应为 1–30 字；分类路径应以小写字母开头，只含小写字母、数字和短横线，且不能使用保留路径。");
    }
    if (ids.has(category.id) || slugs.has(category.slug)) throw new Error("分类 ID 或路径不能重复。");
    ids.add(category.id); slugs.add(category.slug);
    return { id: category.id, name: category.name.trim(), slug: category.slug };
  });
}

export function createSitePublishDraft(origin = ""): SitePublishDraft {
  return { settings: { title: "我的便签网站", description: "记录与分享", author: "", origin, basePath: DEFAULT_SITE_BASE_PATH, logoPath: "", themeId: SITE_THEME_ID }, categories: DEFAULT_SITE_CATEGORIES.map((category) => ({ ...category })), selections: [] };
}

export function getSiteNoteTitle(markdown: string): string {
  const line = markdown.split(/\r?\n/).find((value) => value.trim() && !/^\s*!\[/.test(value))?.trim() ?? "未命名便签";
  return line.replace(/^#{1,6}\s+/, "").replace(/^\[([^\]]+)\]$/, "$1").slice(0, 200);
}

export function buildSiteExportRequest(draft: SitePublishDraft, notes: NoteDocument[]): SiteExportRequest {
  const settings = normalizeSiteSettings(draft.settings);
  const categories = validateSiteCategories(draft.categories);
  const allowedCategories = new Set(categories.map((category) => category.id));
  const liveNotes = new Map(notes.filter((note) => note.deletedAt === null).map((note) => [note.id, note]));
  const selected = new Set<string>();
  const exportedNotes = draft.selections.map(({ noteId, categoryId }) => {
    const note = liveNotes.get(noteId);
    if (!note) throw new Error("所选便签已删除或移入回收站，请重新选择。");
    if (!allowedCategories.has(categoryId)) throw new Error("请为所选便签指定有效分类。");
    if (selected.has(noteId)) throw new Error("便签不能重复发布。");
    selected.add(noteId);
    return { id: note.id, markdown: note.markdown, createdAt: note.createdAt, updatedAt: note.updatedAt, deletedAt: null, categoryId };
  });
  if (!exportedNotes.length) throw new Error("请选择至少一张便签生成网站。");
  return { settings, categories, notes: exportedNotes };
}
