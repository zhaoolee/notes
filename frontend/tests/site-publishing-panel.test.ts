import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SitePublishPanel } from "../../src/features/site-publishing/SitePublishPanel.js";
import {
  SITE_EXPORT_ENDPOINT,
  SITE_EXPORT_FILENAME,
  SitePublishExportError,
  downloadSiteExport,
  exportSitePublishSite,
} from "../../src/features/site-publishing/client.js";
import {
  SITE_PUBLISH_STORAGE_PREFIX,
  loadSitePublishDraft,
  pruneSitePublishDraft,
  saveSitePublishDraft,
  sitePublishStorageKey,
  type SitePublishStorage,
} from "../../src/features/site-publishing/draft-storage.js";
import {
  DEFAULT_SITE_LOGO_PATH,
  normalizeSiteLogoPath,
  validateSiteLogoFile,
} from "../../src/features/site-publishing/logo.js";
import {
  DEFAULT_SITE_BASE_PATH,
  DEFAULT_SITE_CATEGORIES,
  SITE_THEMES,
  SITE_THEME_ID,
  buildSiteExportRequest,
  createSitePublishDraft,
  normalizeSiteSettings,
  type SitePublishDraft,
} from "../../src/features/site-publishing/model.js";
import type { NoteDocument } from "../../src/types/app.js";

const noop = () => undefined;
const CUSTOM_LOGO_PATH = `/images/${"a".repeat(64)}.png`;

function makeNote(
  id: string,
  title: string,
  overrides: Partial<NoteDocument> = {},
): NoteDocument {
  return {
    id,
    markdown: `# ${title}\n\n${title}的正文内容。`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    normalOrder: 0,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
    ...overrides,
  };
}

function createMemoryStorage(
  initial: Record<string, string> = {},
): SitePublishStorage & { entries(): Map<string, string> } {
  const map = new Map(Object.entries(initial));

  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    entries: () => map,
  };
}

function setGlobalLocalStorage(storage: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });

  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  };
}

function createPublishDraft(): SitePublishDraft {
  const draft = createSitePublishDraft("https://notes.example.com");
  draft.settings.title = "我的便签网站";
  draft.settings.description = "记录与分享";
  draft.settings.author = "测试作者";
  draft.selections = [{ noteId: "note-a", categoryId: "guides" }];
  return draft;
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function createFetch(
  createResponse: () => Response,
  captured: CapturedRequest[],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(input), init: init ?? {} });
    return createResponse();
  }) as typeof fetch;
}

test("网站 Logo 字段缺省兼容旧设置，只接受本机图片导入路径", () => {
  const base = createSitePublishDraft().settings;

  assert.equal(base.logoPath, "");
  assert.equal(
    normalizeSiteSettings({ ...base, logoPath: undefined }).logoPath,
    "",
  );
  assert.equal(
    normalizeSiteSettings({ ...base, logoPath: "" }).logoPath,
    "",
  );
  assert.equal(
    normalizeSiteSettings({ ...base, logoPath: CUSTOM_LOGO_PATH }).logoPath,
    CUSTOM_LOGO_PATH,
  );
  assert.equal(normalizeSiteLogoPath(undefined), "");

  for (const logoPath of [
    null,
    123,
    "https://example.test/logo.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "/images/../secret.png",
    "/images/%2e%2e/secret.png",
    "/images/logo.png",
    `/images/${"a".repeat(64)}.svg`,
    `${CUSTOM_LOGO_PATH}?v=1`,
    `https://notes.example.test${CUSTOM_LOGO_PATH}`,
  ]) {
    assert.throws(
      () => normalizeSiteSettings({ ...base, logoPath }),
      /网站 Logo/,
      String(logoPath),
    );
  }
});

test("上传网站 Logo 前校验格式与 2MB 上限，明确拒绝 SVG", () => {
  assert.equal(
    validateSiteLogoFile({ name: "logo.png", type: "image/png", size: 1024 }),
    "",
  );
  assert.equal(
    validateSiteLogoFile({ name: "logo.avif", type: "image/avif", size: 1024 }),
    "",
  );
  assert.equal(
    validateSiteLogoFile({ name: "logo.webp", type: "", size: 1024 }),
    "",
  );
  assert.match(
    validateSiteLogoFile({ name: "logo.svg", type: "image/svg+xml", size: 10 }),
    /不支持 SVG/,
  );
  assert.match(
    validateSiteLogoFile({ name: "logo.png", type: "image/png", size: 2 * 1024 * 1024 + 1 }),
    /2MB/,
  );
  assert.match(
    validateSiteLogoFile({ name: "logo.png", type: "image/png", size: 0 }),
    /有效/,
  );
  assert.match(
    validateSiteLogoFile({ name: "logo.txt", type: "text/plain", size: 10 }),
    /仅支持/,
  );
});

test("站点域名可选：空串和空白通过，非空域名仍严格校验", () => {
  const draft = createSitePublishDraft();
  assert.equal(draft.settings.origin, "");
  const settings = { ...draft.settings, basePath: "blog" };

  assert.equal(normalizeSiteSettings({ ...settings, origin: "" }).origin, "");
  assert.equal(normalizeSiteSettings({ ...settings, origin: "   " }).origin, "");
  assert.equal(
    normalizeSiteSettings({ ...settings, origin: " https://notes.example.com/ " })
      .origin,
    "https://notes.example.com",
  );
  assert.equal(
    normalizeSiteSettings({ ...settings, origin: "   " }).basePath,
    "/blog/",
  );

  for (const origin of [
    "notes.example.com",
    "ftp://notes.example.com",
    "https://notes.example.com/blog/",
    "https://user:pass@notes.example.com",
    "https://notes.example.com?next=1",
    "https://notes.example.com#top",
  ]) {
    assert.throws(
      () => normalizeSiteSettings({ ...settings, origin }),
      /站点域名|完整的站点域名/,
      origin,
    );
  }
});

test("新草稿默认 /notes/，规范化补齐斜杠，显式根路径与自定义路径保持", () => {
  const draft = createSitePublishDraft();
  assert.equal(DEFAULT_SITE_BASE_PATH, "/notes/");
  assert.equal(draft.settings.basePath, DEFAULT_SITE_BASE_PATH);
  assert.equal(draft.settings.origin, "");

  const normalized = (basePath: string) =>
    normalizeSiteSettings({ ...draft.settings, basePath }).basePath;
  assert.equal(normalized("/notes"), "/notes/");
  assert.equal(normalized("/notes/"), "/notes/");
  assert.equal(normalized("/"), "/");
  assert.equal(normalized("/blog/"), "/blog/");
  assert.equal(normalized("/knowledge/notes"), "/knowledge/notes/");
  assert.equal(normalized(""), "/");
  assert.throws(() => normalizeSiteSettings({ ...draft.settings, basePath: "notes?x=1" }), /basePath 只能包含/);

  // 已保存的根路径和自定义路径仍是权威值，不会因为新默认值被自动迁移。
  const storage = createMemoryStorage();
  const saveSettings = (scope: string, basePath: string) => {
    storage.setItem(
      sitePublishStorageKey(scope),
      JSON.stringify({
        version: 1,
        settings: { ...draft.settings, basePath },
        categories: DEFAULT_SITE_CATEGORIES,
        selections: [],
      }),
    );
    return loadSitePublishDraft(storage, scope, []).settings.basePath;
  };
  assert.equal(saveSettings("saved-root", "/"), "/");
  assert.equal(saveSettings("saved-custom", "/legacy/blog/"), "/legacy/blog/");
  assert.equal(saveSettings("saved-blank", ""), "");
  assert.equal(saveSettings("saved-invalid", "blog?next=1"), "blog?next=1");
});

test("本机草稿保留空域名、恢复真实域名，不自动补 example.com", () => {
  const storage = createMemoryStorage();
  const notes: NoteDocument[] = [];
  const emptyDraft = createSitePublishDraft();
  emptyDraft.settings.basePath = "blog";

  assert.equal(saveSitePublishDraft(storage, "user-empty", emptyDraft), true);
  const loadedEmpty = loadSitePublishDraft(storage, "user-empty", notes);
  assert.equal(loadedEmpty.settings.origin, "");
  assert.equal(loadedEmpty.settings.basePath, "blog");

  storage.setItem(
    sitePublishStorageKey("user-legacy"),
    JSON.stringify({
      version: 1,
      settings: {
        title: "旧草稿",
        description: "",
        author: "",
        rootPath: "/",
        themeId: SITE_THEME_ID,
      },
      categories: DEFAULT_SITE_CATEGORIES,
      selections: [],
    }),
  );
  assert.equal(
    loadSitePublishDraft(storage, "user-legacy", notes).settings.origin,
    "",
  );

  const realDraft = createSitePublishDraft("https://notes.example.com");
  assert.equal(saveSitePublishDraft(storage, "user-real", realDraft), true);
  assert.equal(
    loadSitePublishDraft(storage, "user-real", notes).settings.origin,
    "https://notes.example.com",
  );
});

test("旧 v1 草稿的 rootPath 迁移到 basePath，新保存只写 basePath", () => {
  const storage = createMemoryStorage();
  const notes: NoteDocument[] = [];

  storage.setItem(
    sitePublishStorageKey("user-legacy"),
    JSON.stringify({
      version: 1,
      settings: {
        title: "旧草稿",
        description: "",
        author: "",
        origin: "",
        rootPath: "/legacy/blog",
        themeId: SITE_THEME_ID,
      },
      categories: DEFAULT_SITE_CATEGORIES,
      selections: [],
    }),
  );

  const migrated = loadSitePublishDraft(storage, "user-legacy", notes);
  assert.equal(migrated.settings.basePath, "/legacy/blog");
  assert.equal("rootPath" in migrated.settings, false);

  assert.equal(saveSitePublishDraft(storage, "user-legacy", migrated), true);
  const saved = JSON.parse(
    storage.getItem(sitePublishStorageKey("user-legacy")) ?? "{}",
  ) as { settings: Record<string, unknown> };
  assert.equal(saved.settings.basePath, "/legacy/blog");
  assert.equal("rootPath" in saved.settings, false);
});

test("草稿同时存在 basePath 与 rootPath 时以 basePath 为准", () => {
  const notes: NoteDocument[] = [];
  const base = {
    title: "双键草稿",
    description: "",
    author: "",
    origin: "",
    themeId: SITE_THEME_ID,
  };
  const load = (settings: Record<string, unknown>) => {
    const storage = createMemoryStorage({
      [sitePublishStorageKey("user-both")]: JSON.stringify({
        version: 1,
        settings: { ...base, ...settings },
        categories: DEFAULT_SITE_CATEGORIES,
        selections: [],
      }),
    });
    return loadSitePublishDraft(storage, "user-both", notes).settings.basePath;
  };

  assert.equal(load({ basePath: "/new/blog/", rootPath: "/old/blog/" }), "/new/blog/");
  // 新字段显式存在时，即使为空串或非法输入也优先，并保留原样交给 UI 报错。
  assert.equal(load({ basePath: "", rootPath: "/old/blog/" }), "");
  assert.equal(load({ basePath: "blog?next=1", rootPath: "/old/blog/" }), "blog?next=1");
  assert.equal(load({ rootPath: "/old/blog/" }), "/old/blog/");
});

test("网站草稿保存并恢复 Logo、全部设置与分类选择，旧草稿默认为空", () => {
  const storage = createMemoryStorage();
  const notes = [makeNote("note-a", "甲便签")];
  const draft = createSitePublishDraft(" https://notes.example.com ");
  draft.settings = {
    title: "完整草稿",
    description: "网站简介",
    author: "作者",
    origin: "https://notes.example.com",
    basePath: "/nested/blog/",
    logoPath: CUSTOM_LOGO_PATH,
    themeId: SITE_THEME_ID,
  };
  draft.categories = [
    ...DEFAULT_SITE_CATEGORIES.map((category) => ({ ...category })),
    { id: "custom-1", name: "生活", slug: "life" },
  ];
  draft.selections = [{ noteId: "note-a", categoryId: "custom-1" }];

  assert.equal(saveSitePublishDraft(storage, "user-logo", draft), true);
  const raw = storage.getItem(sitePublishStorageKey("user-logo")) ?? "";
  assert.match(raw, /logoPath/);
  assert.doesNotMatch(raw, /data:image\//);

  const loaded = loadSitePublishDraft(storage, "user-logo", notes);
  assert.deepEqual(loaded.settings, draft.settings);
  assert.deepEqual(loaded.selections, draft.selections);
  assert.deepEqual(
    loaded.categories.map((category) => [category.id, category.name, category.slug]),
    draft.categories.map((category) => [category.id, category.name, category.slug]),
  );

  storage.setItem(
    sitePublishStorageKey("user-legacy-logo"),
    JSON.stringify({
      version: 1,
      settings: {
        title: "旧草稿",
        description: "旧简介",
        author: "旧作者",
        origin: "https://old.example.com",
        basePath: "/old/",
        themeId: SITE_THEME_ID,
      },
      categories: DEFAULT_SITE_CATEGORIES,
      selections: [],
    }),
  );
  const legacy = loadSitePublishDraft(storage, "user-legacy-logo", []);
  assert.equal(legacy.settings.logoPath, "");
  assert.equal(legacy.settings.title, "旧草稿");
  assert.equal(legacy.settings.origin, "https://old.example.com");
  assert.equal(legacy.settings.basePath, "/old/");

  storage.setItem(
    sitePublishStorageKey("user-broken-logo"),
    JSON.stringify({
      version: 1,
      settings: {
        ...draft.settings,
        logoPath: "/images/../private.png",
      },
      categories: draft.categories,
      selections: draft.selections,
    }),
  );
  const broken = loadSitePublishDraft(storage, "user-broken-logo", notes);
  assert.equal(broken.settings.logoPath, "");
  assert.equal(broken.settings.title, "完整草稿");
  assert.deepEqual(broken.selections, draft.selections);
});

test("网站草稿按 storageScope 隔离，加载时不会自动全选现有便签", () => {
  const storage = createMemoryStorage();
  const notes = [makeNote("note-a", "甲便签"), makeNote("note-b", "乙便签")];
  const draft = createPublishDraft();
  draft.settings.title = "甲账号的站点";

  assert.equal(saveSitePublishDraft(storage, "user-a", draft), true);

  const loadedA = loadSitePublishDraft(storage, "user-a", notes);
  assert.equal(loadedA.settings.title, "甲账号的站点");
  assert.deepEqual(loadedA.selections, [
    { noteId: "note-a", categoryId: "guides" },
  ]);

  const loadedB = loadSitePublishDraft(storage, "user-b", notes);
  assert.equal(loadedB.settings.title, "我的便签网站");
  assert.deepEqual(loadedB.selections, []);

  assert.notEqual(
    sitePublishStorageKey("user-a"),
    sitePublishStorageKey("user-b"),
  );
  assert.match(sitePublishStorageKey("user-a"), /^notes\.site-publishing\.v1:/);
  assert.ok(sitePublishStorageKey("user-a").endsWith(":user-a"));
  assert.equal(
    sitePublishStorageKey("   "),
    `${SITE_PUBLISH_STORAGE_PREFIX}:anonymous`,
  );
  assert.equal(storage.entries().size, 1);
});

test("加载草稿会修复陈旧分类与选择，丢弃回收站便签且不补选其他便签", () => {
  const storage = createMemoryStorage();
  const liveOne = makeNote("live-1", "保留便签");
  const liveTwo = makeNote("live-2", "未选择便签");
  const trashed = makeNote("trash-1", "回收站便签", { deletedAt: 123 });
  const draft = createSitePublishDraft("https://notes.example.com");

  draft.categories = [
    ...DEFAULT_SITE_CATEGORIES.map((category) => ({ ...category })),
    { id: "custom-1", name: "随笔", slug: "essay" },
    { id: "custom-2", name: "坏分类", slug: "Bad Slug" },
  ];
  draft.selections = [
    { noteId: "live-1", categoryId: "custom-1" },
    { noteId: "live-1", categoryId: "guides" },
    { noteId: "trash-1", categoryId: "guides" },
    { noteId: "ghost-note", categoryId: "guides" },
    { noteId: "live-2", categoryId: "ghost-category" },
  ];

  assert.equal(saveSitePublishDraft(storage, "user-a", draft), true);

  const loaded = loadSitePublishDraft(storage, "user-a", [
    liveOne,
    liveTwo,
    trashed,
  ]);

  assert.deepEqual(loaded.selections, [
    { noteId: "live-1", categoryId: "custom-1" },
  ]);
  assert.deepEqual(
    loaded.categories.map((category) => category.id),
    [...DEFAULT_SITE_CATEGORIES.map((category) => category.id), "custom-1"],
  );
  assert.ok(!loaded.categories.some((category) => category.id === "custom-2"));

  const withStaleSelection = {
    ...loaded,
    selections: [
      ...loaded.selections,
      { noteId: "live-2", categoryId: "guides" },
    ],
  };
  const pruned = pruneSitePublishDraft(withStaleSelection, [liveOne]);
  assert.deepEqual(pruned.selections, [
    { noteId: "live-1", categoryId: "custom-1" },
  ]);
  assert.equal(pruneSitePublishDraft(pruned, [liveOne]), pruned);
});

test("损坏 JSON、抛错的存储与缺失 localStorage 都不会让面板崩溃", () => {
  const corrupted = createMemoryStorage({
    [sitePublishStorageKey("user-a")]: "{not-json",
  });
  const fallback = loadSitePublishDraft(corrupted, "user-a", []);
  assert.equal(fallback.settings.title, "我的便签网站");
  assert.deepEqual(fallback.selections, []);

  const throwingStorage: SitePublishStorage = {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  assert.equal(
    loadSitePublishDraft(throwingStorage, "user-a", []).settings.title,
    "我的便签网站",
  );
  assert.equal(
    saveSitePublishDraft(throwingStorage, "user-a", fallback),
    false,
  );
  assert.equal(saveSitePublishDraft(null, "user-a", fallback), false);
  assert.deepEqual(loadSitePublishDraft(null, "user-a", []).selections, []);
});

test("面板 SSR 渲染独立对话框，默认按分类分组并折叠高级设置", () => {
  const restore = setGlobalLocalStorage(undefined);

  try {
    const html = renderToStaticMarkup(
      createElement(SitePublishPanel, {
        notes: [makeNote("note-a", "甲便签")],
        storageScope: "anonymous",
        onClose: noop,
      }),
    );

    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    // 默认主业区直接按网站分类分组，空分组只有组头和添加入口。
    assert.match(html, /class="site-publish-group-grid"/);
    for (const name of ["做法", "软件", "硬件", "项目", "杂谈"]) {
      assert.match(html, new RegExp(`aria-label="${name}分类"`));
      assert.match(html, new RegExp(`aria-label="为「${name}」添加便签"`));
    }
    assert.match(html, /0 张/);
    assert.doesNotMatch(html, /已选便签（|尚未选择便签|已选 <strong>/);
    // 网站设置与分类编辑在默认折叠的高级设置里。
    assert.match(html, /<details class="site-publish-advanced">/);
    assert.doesNotMatch(html, /<details[^>]*\sopen/);
    assert.match(
      html,
      /<details class="site-publish-advanced"><summary><span>高级设置<\/span><\/summary><div class="site-publish-advanced-body">/,
    );
    assert.match(html, /网站标题/);
    assert.match(html, /分类设置/);
    assert.match(html, /<span>站长名<\/span>/);
    assert.doesNotMatch(html, /<span>作者<\/span>/);
    assert.match(html, /站点域名（可选）/);
    assert.match(html, /部署路径：<code>\/notes\/<\/code>/);
    assert.match(html, /placeholder="\/notes\/"/);
    assert.match(html, /默认 \/notes\/；自定义子路径如 \/blog\/，根域名填写 \//);
    assert.doesNotMatch(html, /最终访问地址/);
    assert.doesNotMatch(html, /value="https:\/\/example\.com/);
    assert.doesNotMatch(html, /example\.com/);
    // 新增分类行默认不展开，避免一进来就摆出两组输入。
    assert.match(html, /添加分类/);
    assert.doesNotMatch(html, /新分类名称/);
    assert.match(html, /生成网站 ZIP/);
    assert.doesNotMatch(html, /返回编辑/);
    assert.match(html, /aria-label="关闭网站发布面板"/);
    assert.match(html, /网站 Logo/);
    assert.match(html, /src="\/smartisan\/web\/smartisan_hammer_footer\.png"/);
    assert.match(html, /上传图片/);
    assert.doesNotMatch(html, />恢复默认</);
    assert.match(html, /正在读取账号设置/);
    assert.doesNotMatch(html, /最多 200|这些信息只写入|默认使用锤子图标/);
    assert.doesNotMatch(html, /连接 GitHub|部署到 GitHub|一键部署/);
    // 目前只有一种站点模板，不渲染“网站样式”选择区；元数据列表仍保留默认主题。
    assert.equal(SITE_THEMES.length, 1);
    assert.equal(SITE_THEMES[0].id, SITE_THEME_ID);
    assert.doesNotMatch(html, /网站样式/);
    assert.doesNotMatch(html, /type="radio"/);
    assert.doesNotMatch(html, /经典便签博客/);
    assert.match(html, /data-site-publish-storage="saved"/);
  } finally {
    restore();
  }
});

test("面板 SSR 从本机草稿恢复分组选择与分类，并展示最终子路径地址", () => {
  const storage = createMemoryStorage();
  const restore = setGlobalLocalStorage(storage);

  try {
    const draft = createPublishDraft();
    draft.settings.basePath = "blog";
    assert.equal(saveSitePublishDraft(storage, "user-a", draft), true);

    const html = renderToStaticMarkup(
      createElement(SitePublishPanel, {
        notes: [makeNote("note-a", "甲便签"), makeNote("note-b", "乙便签")],
        storageScope: "user-a",
        onClose: noop,
      }),
    );

    assert.match(html, /aria-label="做法分类"/);
    assert.match(html, /1 张/);
    assert.match(html, /<strong>甲便签<\/strong>/);
    assert.match(html, /aria-label="从「做法」移除甲便签"/);
    assert.doesNotMatch(html, /“甲便签”的网站分类/);
    assert.doesNotMatch(html, /<select/);
    assert.match(html, /https:\/\/notes\.example\.com\/blog\//);
    assert.doesNotMatch(html, /2 张/);

    draft.settings.logoPath = CUSTOM_LOGO_PATH;
    assert.equal(saveSitePublishDraft(storage, "user-logo-panel", draft), true);
    const logoHtml = renderToStaticMarkup(
      createElement(SitePublishPanel, {
        notes: [makeNote("note-a", "甲便签")],
        storageScope: "user-logo-panel",
        onClose: noop,
      }),
    );
    assert.match(
      logoHtml,
      new RegExp(`src="${CUSTOM_LOGO_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
    assert.match(logoHtml, /更换图片/);
    assert.match(logoHtml, />恢复默认</);
    assert.doesNotMatch(logoHtml, new RegExp(`src="${DEFAULT_SITE_LOGO_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));

    const otherScopeHtml = renderToStaticMarkup(
      createElement(SitePublishPanel, {
        notes: [makeNote("note-a", "甲便签"), makeNote("note-b", "乙便签")],
        storageScope: "user-b",
        onClose: noop,
      }),
    );
    assert.doesNotMatch(otherScopeHtml, /<strong>甲便签<\/strong>/);
    assert.doesNotMatch(otherScopeHtml, /aria-label="从「做法」移除/);
    assert.match(otherScopeHtml, /0 张/);
  } finally {
    restore();
  }
});

test("空域名草稿恢复后显示部署路径，不预填示例域名", () => {
  const storage = createMemoryStorage();
  const restore = setGlobalLocalStorage(storage);

  try {
    const draft = createSitePublishDraft("   ");
    draft.settings.basePath = "blog";
    assert.equal(saveSitePublishDraft(storage, "user-empty", draft), true);

    const html = renderToStaticMarkup(
      createElement(SitePublishPanel, {
        notes: [makeNote("note-a", "甲便签")],
        storageScope: "user-empty",
        onClose: noop,
      }),
    );

    assert.match(html, /站点域名（可选）/);
    assert.match(html, /value=""/);
    assert.match(html, /部署路径：<code>\/blog\/<\/code>/);
    assert.match(html, /部署子路径（basePath）/);
    assert.match(html, /留空则按当前域名部署/);
    assert.doesNotMatch(html, /最终访问地址/);
    assert.doesNotMatch(html, /value="https:\/\/example\.com/);
    assert.doesNotMatch(html, /example\.com/);
  } finally {
    restore();
  }
});

test("localStorage 读取抛错时面板仍能 SSR 渲染空草稿", () => {
  const restore = setGlobalLocalStorage({
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {
      throw new Error("storage blocked");
    },
  });

  try {
    const html = renderToStaticMarkup(
      createElement(SitePublishPanel, {
        notes: [makeNote("note-a", "甲便签")],
        storageScope: "user-a",
        onClose: noop,
      }),
    );

    assert.match(html, /role="dialog"/);
    assert.match(html, /data-site-publish-autofocus/);
    assert.match(html, /aria-label="做法分类"/);
    assert.match(html, /0 张/);
    assert.match(html, /<details class="site-publish-advanced">/);
  } finally {
    restore();
  }
});

test("无效 basePath 在面板中明确报错，保留用户输入且不自动回退", () => {
  const storage = createMemoryStorage();
  const restore = setGlobalLocalStorage(storage);

  try {
    const draft = createPublishDraft();
    draft.settings.basePath = "blog?next=1";
    assert.equal(saveSitePublishDraft(storage, "user-a", draft), true);

    const html = renderToStaticMarkup(
      createElement(SitePublishPanel, {
        notes: [makeNote("note-a", "甲便签")],
        storageScope: "user-a",
        onClose: noop,
      }),
    );

    assert.match(html, /value="blog\?next=1"/);
    assert.match(html, /无法生成最终访问地址/);
    assert.match(html, /basePath 只能包含/);
    assert.match(html, /不会自动回退/);
    assert.match(html, /aria-invalid="true"/);
    assert.doesNotMatch(html, /最终访问地址：<code>https:\/\/notes\.example\.com\/<\/code>/);
  } finally {
    restore();
  }
});

test("导出客户端提交草稿、同源 Cookie、ZIP 文件名与错误消息符合契约", async () => {
  const draft = createPublishDraft();
  const notes = [makeNote("note-a", "甲便签")];
  const captured: CapturedRequest[] = [];
  const zipResponse = () =>
    new Response(new Blob(["PK\u0003\u0004"], { type: "application/zip" }), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${SITE_EXPORT_FILENAME}"`,
      },
    });
  const fetchImpl = createFetch(zipResponse, captured);

  const artifact = await exportSitePublishSite(draft, notes, { fetchImpl });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, SITE_EXPORT_ENDPOINT);
  assert.equal(captured[0].init.method, "POST");
  assert.equal(captured[0].init.credentials, "same-origin");
  assert.equal(
    new Headers(captured[0].init.headers).get("content-type"),
    "application/json",
  );
  assert.deepEqual(
    JSON.parse(String(captured[0].init.body)),
    buildSiteExportRequest(draft, notes),
  );
  const submitted = JSON.parse(String(captured[0].init.body)) as {
    settings: Record<string, unknown>;
  };
  assert.equal(submitted.settings.basePath, DEFAULT_SITE_BASE_PATH);
  assert.equal(submitted.settings.logoPath, "");
  assert.equal(submitted.settings.themeId, SITE_THEME_ID);
  assert.equal("rootPath" in submitted.settings, false);
  assert.equal(artifact.filename, SITE_EXPORT_FILENAME);
  assert.equal(artifact.blob.type, "application/zip");
  assert.equal(artifact.blob.size, 4);

  const failing = createFetch(
    () =>
      new Response(JSON.stringify({ error: "Hugo 模板暂不可用。" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    [],
  );
  await assert.rejects(
    exportSitePublishSite(draft, notes, { fetchImpl: failing }),
    (error: unknown) => {
      assert.ok(error instanceof SitePublishExportError);
      assert.equal(error.status, 503);
      assert.match(error.message, /Hugo 模板暂不可用/);
      return true;
    },
  );

  const wrongContentType = createFetch(
    () =>
      new Response(JSON.stringify({ error: "后端尚未更新导出接口。" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    [],
  );
  await assert.rejects(
    exportSitePublishSite(draft, notes, { fetchImpl: wrongContentType }),
    /后端尚未更新导出接口/,
  );

  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(
    exportSitePublishSite(draft, notes, { fetchImpl: offline }),
    /无法连接网站导出服务/,
  );

  const aborted = (async () => {
    throw new DOMException("Aborted", "AbortError");
  }) as typeof fetch;
  await assert.rejects(
    exportSitePublishSite(draft, notes, { fetchImpl: aborted }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("导出前本地校验失败时不会发起网络请求", async () => {
  const draft = createPublishDraft();
  draft.settings.basePath = "blog/../secret";
  const notes = [makeNote("note-a", "甲便签")];
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  }) as typeof fetch;

  await assert.rejects(
    exportSitePublishSite(draft, notes, { fetchImpl }),
    /basePath 只能包含/,
  );
  assert.equal(fetchCalls, 0);

  const deletedNoteDraft = createPublishDraft();
  await assert.rejects(
    exportSitePublishSite(
      deletedNoteDraft,
      [makeNote("note-a", "甲便签", { deletedAt: 99 })],
      { fetchImpl },
    ),
    /回收站/,
  );
  assert.equal(fetchCalls, 0);
});

test("下载 ZIP 时创建临时链接并在点击后释放 object URL", () => {
  const blob = new Blob(["zip"], { type: "application/zip" });
  const clicks: string[] = [];
  const revoked: string[] = [];
  let removed = false;
  let appended: unknown = null;
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click() {
      clicks.push(this.download);
    },
    remove() {
      removed = true;
    },
  };
  const ownerDocument = {
    body: {
      appendChild(node: unknown) {
        appended = node;
      },
    },
    createElement(tag: string) {
      assert.equal(tag, "a");
      return anchor;
    },
  };

  const url = downloadSiteExport(
    { blob, filename: SITE_EXPORT_FILENAME },
    {
      document: ownerDocument as unknown as Pick<
        Document,
        "body" | "createElement"
      >,
      createObjectURL(value) {
        assert.equal(value, blob);
        return "blob:notes-hugo-site";
      },
      revokeObjectURL(value) {
        revoked.push(value);
      },
    },
  );

  assert.equal(url, "blob:notes-hugo-site");
  assert.equal(anchor.href, "blob:notes-hugo-site");
  assert.equal(anchor.download, SITE_EXPORT_FILENAME);
  assert.equal(anchor.rel, "noopener");
  assert.deepEqual(clicks, [SITE_EXPORT_FILENAME]);
  assert.equal(appended, anchor);
  assert.equal(removed, true);
  assert.deepEqual(revoked, ["blob:notes-hugo-site"]);
});

test("面板样式只使用 site-publish 作用域，并覆盖窄屏与暗色主题", () => {
  const css = readFileSync(
    new URL("../../src/features/site-publishing/panel.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(css, /(^|\n)\s*(html|body|#root|button|input|select|textarea)\s*\{/);
  assert.doesNotMatch(css, /\.ai-review-|\.settings-|\.markdown-editor/);
  assert.match(css, /\.site-publish-backdrop\s*\{/);
  assert.match(css, /\.site-publish-panel\s*\{/);
  assert.match(css, /\.site-publish-footer\s*\{/);
  assert.match(css, /grid-template-columns:/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(
    css,
    /:root\[data-theme="smartisan-dark"\] \.site-publish-panel|:root\[data-theme="smartisan-dark"\] \.site-publish-card/,
  );
  assert.match(css, /overflow-x: hidden/);
  assert.match(css, /min-width: 0/);
});
