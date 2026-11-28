import { normalizeSiteLogoPath } from "../../src/features/site-publishing/logo.js";
import {
  isSiteThemeId,
  type SiteCategory,
  type SitePublishDraft,
  type SiteSelection,
  type SiteSettings,
} from "../../src/features/site-publishing/model.js";

/**
 * 账号级网站发布草稿的受限解析。
 *
 * 草稿用于跨设备恢复“网站设置 / 分类 / 已选便签”，只接受这些字段，绝不保存便签正文。
 * 与导出校验不同，这里允许用户编辑中的半成品：空标题、空分类名、重复分类、
 * 尚未拼完整的域名与 basePath 都原样保存，最终导出仍由 build.ts 严格校验。
 */
export const SITE_PUBLISH_CONFIGURATION_MAX_BYTES = 1024 * 1024;

const limits = {
  title: 100,
  description: 500,
  author: 100,
  origin: 500,
  basePath: 160,
  categories: 30,
  categoryId: 80,
  categoryName: 30,
  categorySlug: 48,
  selectionNoteId: 200,
  selectionCategoryId: 80,
} as const;

export class InvalidSitePublishConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSitePublishConfigurationError";
  }
}

export class SitePublishConfigurationConflictError extends Error {
  readonly updatedAt: number | null;

  constructor(updatedAt: number | null) {
    super("网站发布设置已被其他设备更新，请刷新后重试。");
    this.name = "SitePublishConfigurationConflictError";
    this.updatedAt = updatedAt;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredText(
  record: UnknownRecord,
  field: string,
  maxLength: number,
  label: string,
): string {
  const value = record[field];

  if (typeof value !== "string") {
    throw new InvalidSitePublishConfigurationError(
      `${label}应为文本，请重新打开发布面板。`,
    );
  }

  if (value.length > maxLength) {
    throw new InvalidSitePublishConfigurationError(
      `${label}不能超过 ${maxLength} 个字符。`,
    );
  }

  return value;
}

function readBasePath(settings: UnknownRecord): string {
  // 旧客户端与旧草稿只有 rootPath；新字段显式存在时以它为准，即使它是空串或非法草稿值。
  const value = Object.prototype.hasOwnProperty.call(settings, "basePath")
    ? settings.basePath
    : settings.rootPath;

  if (typeof value !== "string") {
    throw new InvalidSitePublishConfigurationError(
      "部署路径应为文本，请重新打开发布面板。",
    );
  }

  if (value.length > limits.basePath) {
    throw new InvalidSitePublishConfigurationError(
      `部署路径不能超过 ${limits.basePath} 个字符。`,
    );
  }

  return value;
}

function readLogoPath(settings: UnknownRecord): string {
  const value = settings.logoPath;

  // Logo 是后加字段：旧草稿/旧客户端完全缺失时使用默认锤子图标。
  if (value === undefined) {
    return "";
  }

  try {
    return normalizeSiteLogoPath(value);
  } catch (error) {
    throw new InvalidSitePublishConfigurationError(
      error instanceof Error
        ? error.message
        : "网站 Logo 路径不正确，请重新上传图片。",
    );
  }
}

function readSettings(value: unknown): SiteSettings {
  if (!isRecord(value)) {
    throw new InvalidSitePublishConfigurationError(
      "网站设置不完整，请重新打开发布面板。",
    );
  }

  const themeId = value.themeId;

  if (!isSiteThemeId(themeId)) {
    throw new InvalidSitePublishConfigurationError("不支持此网站样式。");
  }

  return {
    title: readRequiredText(value, "title", limits.title, "网站名称"),
    description: readRequiredText(
      value,
      "description",
      limits.description,
      "网站简介",
    ),
    author: readRequiredText(value, "author", limits.author, "作者名称"),
    origin: readRequiredText(value, "origin", limits.origin, "站点域名"),
    basePath: readBasePath(value),
    logoPath: readLogoPath(value),
    themeId,
  };
}

function readCategories(value: unknown): SiteCategory[] {
  if (!Array.isArray(value)) {
    throw new InvalidSitePublishConfigurationError(
      "网站分类格式不正确，请重新打开发布面板。",
    );
  }

  if (value.length < 1 || value.length > limits.categories) {
    throw new InvalidSitePublishConfigurationError(
      `网站需要 1–${limits.categories} 个分类。`,
    );
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new InvalidSitePublishConfigurationError(
        `第 ${index + 1} 个分类格式不正确。`,
      );
    }

    const id = readRequiredText(
      entry,
      "id",
      limits.categoryId,
      `第 ${index + 1} 个分类的 ID`,
    );

    if (!id) {
      throw new InvalidSitePublishConfigurationError(
        `第 ${index + 1} 个分类缺少 ID。`,
      );
    }

    // 编辑中的空名称、重复 ID/路径和非法 slug 允许暂存，导出时再严格校验。
    return {
      id,
      name: readRequiredText(
        entry,
        "name",
        limits.categoryName,
        `第 ${index + 1} 个分类的名称`,
      ),
      slug: readRequiredText(
        entry,
        "slug",
        limits.categorySlug,
        `第 ${index + 1} 个分类的路径`,
      ),
    };
  });
}

function readSelections(value: unknown): SiteSelection[] {
  if (!Array.isArray(value)) {
    throw new InvalidSitePublishConfigurationError(
      "便签选择格式不正确，请重新打开发布面板。",
    );
  }

  // 不设张数上限，也不按当前工作区丢弃 ID：前端会用当前账号已加载的便签做修复。
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new InvalidSitePublishConfigurationError(
        `第 ${index + 1} 个便签选择格式不正确。`,
      );
    }

    const noteId = readRequiredText(
      entry,
      "noteId",
      limits.selectionNoteId,
      `第 ${index + 1} 个便签选择`,
    );
    const categoryId = readRequiredText(
      entry,
      "categoryId",
      limits.selectionCategoryId,
      `第 ${index + 1} 个便签分类`,
    );

    if (!noteId || !categoryId) {
      throw new InvalidSitePublishConfigurationError(
        `第 ${index + 1} 个便签选择缺少便签或分类。`,
      );
    }

    return { noteId, categoryId };
  });
}

function ensureJsonSize(value: unknown): void {
  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new InvalidSitePublishConfigurationError(
      "网站发布设置格式不正确。",
    );
  }

  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > SITE_PUBLISH_CONFIGURATION_MAX_BYTES
  ) {
    throw new InvalidSitePublishConfigurationError(
      "网站发布设置过大，请减少分类或所选便签后重试。",
    );
  }
}

/**
 * 解析并裁剪账号草稿。只保留 settings/categories/selections 的已知字段，
 * 额外字段（包括便签正文或 ownerId）一律丢弃。
 */
export function parseSitePublishDraft(value: unknown): SitePublishDraft {
  if (!isRecord(value)) {
    throw new InvalidSitePublishConfigurationError(
      "网站发布设置格式不正确，请重新打开发布面板。",
    );
  }

  ensureJsonSize(value);

  const draft: SitePublishDraft = {
    settings: readSettings(value.settings),
    categories: readCategories(value.categories),
    selections: readSelections(value.selections),
  };

  ensureJsonSize(draft);
  return draft;
}
