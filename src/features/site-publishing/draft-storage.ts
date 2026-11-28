import type { NoteDocument } from "../../types/app.js";
import { normalizeSiteLogoPath } from "./logo.js";
import {
  DEFAULT_SITE_CATEGORIES,
  isSiteThemeId,
  createSitePublishDraft,
  validateSiteCategories,
  type SiteCategory,
  type SitePublishDraft,
  type SiteSelection,
  type SiteSettings,
} from "./model.js";

/**
 * 网站发布草稿的本机缓存，按 storageScope（通常是 authUser.id）隔离；账号同步由 account-sync.ts 管理。
 * key 带版本号，便于后续结构升级时不误读旧草稿。
 */
export const SITE_PUBLISH_STORAGE_PREFIX = "notes.site-publishing.v1";

export interface SitePublishStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

export function sitePublishStorageKey(storageScope: string): string {
  const scope = typeof storageScope === "string" ? storageScope.trim() : "";
  return `${SITE_PUBLISH_STORAGE_PREFIX}:${scope || "anonymous"}`;
}

/** SSR、隐私模式和受限 iframe 中 localStorage 可能不存在或抛错，统一下降级为 null。 */
export function resolveSitePublishStorage(): SitePublishStorage | null {
  try {
    if (typeof globalThis === "undefined") {
      return null;
    }

    const storage = (globalThis as { localStorage?: SitePublishStorage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function defaultDraft(): SitePublishDraft {
  return createSitePublishDraft();
}

function sanitizeSettings(value: unknown, fallback: SiteSettings): SiteSettings {
  if (!isRecord(value)) {
    return { ...fallback };
  }

  const title = asText(value.title, 100)?.trim();
  const description = asText(value.description, 500);
  const author = asText(value.author, 100);
  const origin = asText(value.origin, 500);
  // 旧版 v1 草稿只有 rootPath。仅当新字段完全不存在时才回退；新字段显式存在时以它为准，
  // 即使它是空串或非法路径，也要原样保留给 UI 报错。
  const hasBasePath = Object.prototype.hasOwnProperty.call(value, "basePath");
  const rawBasePath = hasBasePath ? value.basePath : value.rootPath;
  // 任何字符串都原样保留（包括过长或含非法字符的输入），只对类型错误回退默认值。
  const basePath = typeof rawBasePath === "string" ? rawBasePath : null;
  // Logo 是后加字段：旧草稿缺失时回到默认锤子图标；损坏或非本机路径也安全恢复默认，
  // 但绝不影响标题、域名、分类和便签选择等其他设置。
  let logoPath = "";
  try {
    logoPath = normalizeSiteLogoPath(value.logoPath);
  } catch {
    logoPath = "";
  }

  return {
    title: title || fallback.title,
    description: description ?? fallback.description,
    author: author ?? fallback.author,
    // 空串代表“不填写域名”，必须原样保留；只有字段缺失或类型错误才回退。
    origin: origin === null ? fallback.origin : origin.trim(),
    // 故意保留原始 basePath：无效输入必须回到 UI 报错，而不是悄悄替换成默认路径。
    basePath: basePath ?? fallback.basePath,
    logoPath,
    themeId: isSiteThemeId(value.themeId) ? value.themeId : fallback.themeId,
  };
}

function sanitizeCategories(value: unknown): SiteCategory[] {
  if (!Array.isArray(value)) {
    return DEFAULT_SITE_CATEGORIES.map((category) => ({ ...category }));
  }

  const categories: SiteCategory[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const candidate: SiteCategory = {
      id: typeof entry.id === "string" ? entry.id : "",
      name: typeof entry.name === "string" ? entry.name : "",
      slug: typeof entry.slug === "string" ? entry.slug : "",
    };

    try {
      const [validated] = validateSiteCategories([candidate]);
      if (ids.has(validated.id) || slugs.has(validated.slug)) {
        continue;
      }

      ids.add(validated.id);
      slugs.add(validated.slug);
      categories.push(validated);
    } catch {
      // 单条分类损坏时丢弃该条，其余仍可继续使用。
    }

    if (categories.length >= 30) {
      break;
    }
  }

  return categories.length
    ? categories
    : DEFAULT_SITE_CATEGORIES.map((category) => ({ ...category }));
}

function sanitizeSelections(
  value: unknown,
  categories: SiteCategory[],
  notes: NoteDocument[],
): SiteSelection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const liveNoteIds = new Set(
    notes.filter((note) => note.deletedAt === null).map((note) => note.id),
  );
  const categoryIds = new Set(categories.map((category) => category.id));
  const seen = new Set<string>();
  const selections: SiteSelection[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const noteId = entry.noteId;
    const categoryId = entry.categoryId;

    if (
      typeof noteId !== "string" ||
      typeof categoryId !== "string" ||
      !liveNoteIds.has(noteId) ||
      !categoryIds.has(categoryId) ||
      seen.has(noteId)
    ) {
      continue;
    }

    seen.add(noteId);
    selections.push({ noteId, categoryId });

  }

  return selections;
}

/**
 * 把任意来源（localStorage、旧版本草稿）的数据修复成可用草稿。
 * 修复规则：
 * - 设置字段类型错误时回退默认值，但保留原始 basePath 交给 UI 校验；
 * - 旧 v1 草稿缺少 basePath 时从 rootPath 迁移，新字段存在时始终优先；
 * - 域名允许空串（按当前域名部署），空串不会被替换成示例域名；
 * - Logo 缺失、类型错误或不是本机导入路径时安全恢复默认锤子图标；
 * - 分类逐条验证，丢弃保留路径 / 重复 slug / 非法字符的分类；
 * - 便签选择只保留“仍在（非回收站）的便签 + 仍存在的分类”，绝不自动全选。
 */
export function sanitizeSitePublishDraft(
  value: unknown,
  notes: NoteDocument[],
): SitePublishDraft {
  const fallback = defaultDraft();

  if (!isRecord(value)) {
    return fallback;
  }

  const categories = sanitizeCategories(value.categories);

  return {
    settings: sanitizeSettings(value.settings, fallback.settings),
    categories,
    selections: sanitizeSelections(value.selections, categories, notes),
  };
}

export function loadSitePublishDraft(
  storage: SitePublishStorage | null | undefined,
  storageScope: string,
  notes: NoteDocument[],
): SitePublishDraft {
  if (!storage) {
    return sanitizeSitePublishDraft(null, notes);
  }

  try {
    const raw = storage.getItem(sitePublishStorageKey(storageScope));
    if (!raw) {
      return sanitizeSitePublishDraft(null, notes);
    }

    return sanitizeSitePublishDraft(JSON.parse(raw) as unknown, notes);
  } catch {
    return sanitizeSitePublishDraft(null, notes);
  }
}

export function saveSitePublishDraft(
  storage: SitePublishStorage | null | undefined,
  storageScope: string,
  draft: SitePublishDraft,
): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(
      sitePublishStorageKey(storageScope),
      JSON.stringify({ version: 1, ...draft }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearSitePublishDraft(
  storage: SitePublishStorage | null | undefined,
  storageScope: string,
): boolean {
  if (!storage) {
    return false;
  }

  try {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(sitePublishStorageKey(storageScope));
    } else {
      storage.setItem(sitePublishStorageKey(storageScope), "");
    }
    return true;
  } catch {
    return false;
  }
}

/** 便签被删除 / 移入回收站后，尽早丢掉对应选择；没有变化时返回原对象以避免重复渲染。 */
export function pruneSitePublishDraft(
  draft: SitePublishDraft,
  notes: NoteDocument[],
): SitePublishDraft {
  const liveNoteIds = new Set(
    notes.filter((note) => note.deletedAt === null).map((note) => note.id),
  );
  const categoryIds = new Set(draft.categories.map((category) => category.id));
  const selections = draft.selections.filter(
    (selection) =>
      liveNoteIds.has(selection.noteId) && categoryIds.has(selection.categoryId),
  );

  return selections.length === draft.selections.length
    ? draft
    : { ...draft, selections };
}
