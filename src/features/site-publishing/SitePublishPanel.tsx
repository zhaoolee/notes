import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { importImageFile } from "../../lib/images.js";
import type { NoteDocument } from "../../types/app.js";
import { SitePublishingAccountSync, type AccountSyncState } from "./account-sync.js";
import { GitHubPublishControls } from "./GitHubPublishControls.js";
import type { GitHubPublishRedirect } from "./github-client.js";
import { SitePublishContent } from "./SitePublishContent.js";
import {
  downloadSiteExport,
  exportSitePublishSite,
} from "./client.js";
import {
  loadSitePublishDraft,
  pruneSitePublishDraft,
  resolveSitePublishStorage,
  saveSitePublishDraft,
} from "./draft-storage.js";
import {
  DEFAULT_SITE_LOGO_PATH,
  SITE_LOGO_ACCEPT,
  SITE_LOGO_MAX_BYTES,
  normalizeSiteLogoPath,
  validateSiteLogoFile,
} from "./logo.js";
import {
  DEFAULT_SITE_CATEGORIES,
  SITE_THEMES,
  SITE_THEME_ID,
  normalizeBasePath,
  normalizeSiteSettings,
  validateSiteCategories,
  type SiteCategory,
  type SitePublishDraft,
  type SiteSettings,
} from "./model.js";

interface SitePublishPanelProps {
  notes: NoteDocument[];
  storageScope: string;
  githubPublishRedirect?: GitHubPublishRedirect | null;
  onClose: () => void;
}

// 组件在浏览器中按需加载独立样式；Node/SSR 测试环境不会触碰 DOM 或 .css 文件。
if (typeof document !== "undefined") {
  // @ts-ignore -- Vite 在浏览器端处理 CSS 动态导入；feedback 的 Node tsconfig 不加载 vite/client 类型。
  void import("./panel.css");
}

const MAX_SITE_CATEGORIES = 30;

function getSiteAddressPreview(settings: SiteSettings): {
  address: string;
  hasOrigin: boolean;
  error: string;
} {
  try {
    const normalized = normalizeSiteSettings({
      ...settings,
      // 地址预览只关心域名和子路径；空标题会由导出按钮统一报错。
      title: settings.title.trim() || "站点",
      themeId: SITE_THEME_ID,
    });
    const hasOrigin = normalized.origin.length > 0;

    return {
      address: hasOrigin
        ? `${normalized.origin}${normalized.basePath}`
        : normalized.basePath,
      hasOrigin,
      error: "",
    };
  } catch (error) {
    return {
      address: "",
      hasOrigin: false,
      error: error instanceof Error ? error.message : "网站设置不完整。",
    };
  }
}

function getBasePathError(value: string): string {
  try {
    normalizeBasePath(value);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "部署子路径格式不正确。";
  }
}

/** 图片导入接口也接受 MIME 回退；确认浏览器能解码后才替换原 Logo。 */
function verifyLogoPreview(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => finish(new Error("图片预览加载超时，请重新上传。")), 15_000);
    function finish(error?: Error) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    }
    image.onload = () => finish();
    image.onerror = () => finish(new Error("图片无法显示，请选择一张有效的图片。"));
    image.src = source;
  });
}

function nextCategoryId(categories: SiteCategory[]): string {
  const used = new Set(categories.map((category) => category.id));

  for (let index = 1; index <= 999; index += 1) {
    const candidate = `custom-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  return `custom-${Date.now().toString(36)}`;
}

function isDefaultCategory(category: SiteCategory): boolean {
  return DEFAULT_SITE_CATEGORIES.some((item) => item.id === category.id);
}

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) {
    return [];
  }

  const selector = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "summary",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.matches(":disabled") &&
      // 折叠的 <details> 内容仍在 DOM 里且可能有布局盒，checkVisibility 才能识别；
      // 不支持该 API 的环境退回 getClientRects。
      (typeof element.checkVisibility === "function"
        ? element.checkVisibility({ checkVisibilityCSS: true })
        : element.getClientRects().length > 0),
  );
}

export function SitePublishPanel({
  notes,
  storageScope,
  githubPublishRedirect = null,
  onClose,
}: SitePublishPanelProps) {
  const titleId = useId();
  const categoriesHeadingId = useId();
  const themeId = useId();
  const logoInputId = useId();

  const panelRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const scopeRef = useRef(storageScope);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const accountSyncRef = useRef<SitePublishingAccountSync | null>(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const closingRef = useRef(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  // 每次上传分配新 token；关闭面板、切换账号或恢复默认时立即作废旧上传的后续结果。
  const logoUploadTokenRef = useRef(0);
  const logoBusyRef = useRef(false);

  const [draft, setDraft] = useState<SitePublishDraft>(() =>
    loadSitePublishDraft(resolveSitePublishStorage(), storageScope, notes),
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [storageState, setStorageState] = useState<
    "saved" | "unavailable"
  >("saved");
  const [accountState, setAccountState] = useState<AccountSyncState>({ status: "loading", error: "" });
  const [closing, setClosing] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategorySlug, setNewCategorySlug] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const [githubConfigured, setGithubConfigured] = useState(false);

  const addressPreview = getSiteAddressPreview(draft.settings);
  const basePathError = getBasePathError(draft.settings.basePath);
  const hasCustomLogo = Boolean(draft.settings.logoPath);
  const logoPreviewSrc =
    draft.settings.logoPath || DEFAULT_SITE_LOGO_PATH;

  useEffect(() => {
    mountedRef.current = true;

    if (typeof document !== "undefined") {
      const active = document.activeElement;
      restoreFocusRef.current = active instanceof HTMLElement ? active : null;
      panelRef.current
        ?.querySelector<HTMLElement>("[data-site-publish-autofocus]")
        ?.focus();
    }

    return () => {
      mountedRef.current = false;
      logoUploadTokenRef.current += 1;
      logoBusyRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;

      try {
        restoreFocusRef.current?.focus();
      } catch {
        // 原焦点元素可能已卸载，忽略即可。
      }
    };
  }, []);

  useEffect(() => {
    setDraft((current) => pruneSitePublishDraft(current, notes));
  }, [notes]);

  useEffect(() => {
    const sync = new SitePublishingAccountSync({
      scope: storageScope,
      storage: resolveSitePublishStorage(),
      notes: notesRef.current,
      onDraft: (remote) => {
        const next = pruneSitePublishDraft(remote, notesRef.current);
        draftRef.current = next;
        setDraft(next);
      },
      onState: setAccountState,
    });
    accountSyncRef.current = sync;
    void sync.start();
    const flush = () => { sync.edit(draftRef.current); void sync.flush(); };
    const retry = () => { void sync.retry(); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", retry);
      sync.edit(draftRef.current);
      sync.dispose();
      if (accountSyncRef.current === sync) accountSyncRef.current = null;
    };
  }, [storageScope]);

  useEffect(() => { accountSyncRef.current?.edit(draft); }, [draft, storageScope]);

  useEffect(() => {
    setLogoPreviewError(false);
  }, [draft.settings.logoPath]);

  // 必须在切 scope 的重载 effect 之前执行：旧 scope 的草稿不能写进新 key。
  useEffect(() => {
    if (scopeRef.current !== storageScope) {
      return;
    }

    const saved = saveSitePublishDraft(
      resolveSitePublishStorage(),
      storageScope,
      draft,
    );
    setStorageState(saved ? "saved" : "unavailable");
  }, [draft, storageScope]);

  // 账号切换时由父组件重挂载；这里再做一层防御，避免把 A 的草稿显示到 B。
  useEffect(() => {
    if (scopeRef.current === storageScope) {
      return;
    }

    scopeRef.current = storageScope;
    logoUploadTokenRef.current += 1;
    logoBusyRef.current = false;
    setLogoUploading(false);
    setLogoPreviewError(false);
    const next = loadSitePublishDraft(
      resolveSitePublishStorage(),
      storageScope,
      notes,
    );
    draftRef.current = next;
    setDraft(next);
    setStorageState("saved");
  }, [storageScope, notes]);

  function updateSettings(patch: Partial<SiteSettings>) {
    setDraft((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
    setError("");
    setNotice("");
  }

  async function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 清空选择，允许用户再次选择同一个文件重试。
    event.target.value = "";

    if (!file) {
      return;
    }

    const validationError = validateSiteLogoFile(file);

    if (validationError) {
      setError(validationError);
      setNotice("");
      return;
    }

    const token = logoUploadTokenRef.current + 1;
    const uploadScope = storageScope;
    logoUploadTokenRef.current = token;
    logoBusyRef.current = true;
    setLogoUploading(true);
    setLogoPreviewError(false);
    setError("");
    setNotice("");

    try {
      const imported = await importImageFile(file);
      const logoPath = normalizeSiteLogoPath(imported.path);

      if (!logoPath) {
        throw new Error("图片服务没有返回有效的本机图片路径。");
      }

      await verifyLogoPreview(logoPath);

      if (
        logoUploadTokenRef.current !== token ||
        !mountedRef.current ||
        scopeRef.current !== uploadScope
      ) {
        return;
      }

      updateSettings({ logoPath });
      setNotice("");
    } catch (caught) {
      if (
        logoUploadTokenRef.current !== token ||
        !mountedRef.current ||
        scopeRef.current !== uploadScope
      ) {
        return;
      }

      setError(
        `网站 Logo 上传失败：${
          caught instanceof Error && caught.message
            ? caught.message
            : "请稍后重试。"
        } 原 Logo 保持不变。`,
      );
      setNotice("");
    } finally {
      if (logoUploadTokenRef.current === token) {
        logoBusyRef.current = false;
        if (mountedRef.current) {
          setLogoUploading(false);
        }
      }
    }
  }

  function restoreDefaultLogo() {
    // 恢复默认也承担“取消在途上传”的作用，晚到的旧结果不能再覆盖用户选择。
    logoUploadTokenRef.current += 1;
    logoBusyRef.current = false;
    setLogoUploading(false);
    setLogoPreviewError(false);

    if (logoInputRef.current) {
      logoInputRef.current.value = "";
    }

    updateSettings({ logoPath: "" });
    setNotice("");
  }

  function updateCategory(categoryId: string, patch: Partial<SiteCategory>) {
    setDraft((current) => ({
      ...current,
      categories: current.categories.map((category) =>
        category.id === categoryId ? { ...category, ...patch } : category,
      ),
    }));
    setError("");
    setNotice("");
  }

  function addCategory(): boolean {
    const name = newCategoryName.trim();
    const slug = newCategorySlug.trim();

    if (!name || !slug) {
      setError("请填写新分类的名称和分类路径。");
      return false;
    }

    if (draft.categories.length >= MAX_SITE_CATEGORIES) {
      setError(`网站最多支持 ${MAX_SITE_CATEGORIES} 个分类。`);
      return false;
    }

    const candidate: SiteCategory = {
      id: nextCategoryId(draft.categories),
      name,
      slug,
    };

    try {
      validateSiteCategories([...draft.categories, candidate]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "新分类名称或路径不符合要求。",
      );
      return false;
    }

    setDraft((current) => ({
      ...current,
      categories: [...current.categories, candidate],
    }));
    setNewCategoryName("");
    setNewCategorySlug("");
    setError("");
    setNotice("");
    return true;
  }

  function removeCategory(category: SiteCategory) {
    if (isDefaultCategory(category)) {
      setError("默认分类不能删除，可以修改名称和分类路径。");
      return;
    }

    const usedCount = draft.selections.filter(
      (selection) => selection.categoryId === category.id,
    ).length;

    if (usedCount > 0) {
      setError(
        `分类「${category.name}」还有 ${usedCount} 张已选便签，请先取消选择或改到其他分类后再移除。`,
      );
      return;
    }

    if (draft.categories.length <= 1) {
      setError("网站至少需要保留一个分类。");
      return;
    }

    setDraft((current) => ({
      ...current,
      categories: current.categories.filter(
        (item) => item.id !== category.id,
      ),
    }));
    setError("");
    setNotice("");
  }

  function removeSelection(noteId: string) {
    setDraft((current) => ({
      ...current,
      selections: current.selections.filter(
        (selection) => selection.noteId !== noteId,
      ),
    }));
    setError("");
    setNotice("");
  }

  /** 勾选即归入当前分类；已属于其他分类的便签直接移动，保证不重复发布。 */
  function assignNoteToCategory(noteId: string, categoryId: string) {
    if (!draft.categories.some((category) => category.id === categoryId)) {
      setError("请先创建至少一个网站分类。");
      return;
    }

    setDraft((current) => {
      const exists = current.selections.some(
        (selection) => selection.noteId === noteId,
      );

      return {
        ...current,
        selections: exists
          ? current.selections.map((selection) =>
              selection.noteId === noteId
                ? { ...selection, categoryId }
                : selection,
            )
          : [...current.selections, { noteId, categoryId }],
      };
    });
    setError("");
    setNotice("");
  }

  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    logoUploadTokenRef.current += 1;
    logoBusyRef.current = false;
    setLogoUploading(false);
    abortRef.current?.abort();
    abortRef.current = null;
    saveSitePublishDraft(
      resolveSitePublishStorage(),
      storageScope,
      draftRef.current,
    );
    const sync = accountSyncRef.current;
    sync?.edit(draftRef.current);
    // Closing the panel flushes the last edit; a slow network never traps the user.
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2_000); });
    void Promise.race([sync?.flush() ?? Promise.resolve(), deadline]).finally(() => {
      clearTimeout(timeout);
      if (mountedRef.current) onClose();
    });
  }

  async function handleExport() {
    if (busyRef.current || logoBusyRef.current) {
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const artifact = await exportSitePublishSite(
        draftRef.current,
        notes,
        { signal: controller.signal },
      );

      if (!mountedRef.current || controller.signal.aborted) {
        return;
      }

      downloadSiteExport(artifact);
      setNotice(
        "网站 ZIP 已生成。",
      );
    } catch (caught) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        (caught instanceof Error && caught.name === "AbortError")
      ) {
        return;
      }

      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "生成网站失败，请稍后重试。",
      );
    } finally {
      busyRef.current = false;

      if (abortRef.current === controller) {
        abortRef.current = null;
      }

      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      handleClose();
      return;
    }

    if (event.key === "Tab") {
      const focusables = focusableElements(panelRef.current);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = typeof document === "undefined" ? null : document.activeElement;
      const inside = Boolean(
        active && panelRef.current?.contains(active),
      );

      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    }

    // 面板内输入与快捷键不应冒泡到底层编辑器（App 在 document 上监听了保存等快捷键）。
    event.stopPropagation();
  }

  const selectedCount = draft.selections.length;
  const canExport = !busy && !logoUploading && !closing && accountState.status !== "loading" && selectedCount > 0;

  return (
    <div className="site-publish-backdrop">
      <section
        ref={panelRef}
        className="site-publish-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        onKeyDown={handleKeyDown}
      >
        <header className="site-publish-header">
          <div className="site-publish-header-copy">
            <h2 id={titleId}>生成网站</h2>
          </div>
          <button
            type="button"
            className="site-publish-close"
            aria-label="关闭网站发布面板"
            onClick={handleClose}
            disabled={closing}
          >
            ×
          </button>
        </header>

        <div
          className="site-publish-body"
          data-site-publish-autofocus
          tabIndex={-1}
        >
        <fieldset className="site-publish-fields-root" disabled={busy || closing || accountState.status === "loading"}>
          <SitePublishContent
            draft={draft}
            notes={notes}
            newCategoryName={newCategoryName}
            newCategorySlug={newCategorySlug}
            maxCategories={MAX_SITE_CATEGORIES}
            onNewCategoryNameChange={setNewCategoryName}
            onNewCategorySlugChange={setNewCategorySlug}
            onAddCategory={addCategory}
            onAssignNote={assignNoteToCategory}
            onRemoveNote={removeSelection}
          />

          <GitHubPublishControls
            draft={draft}
            notes={notes}
            storageScope={storageScope}
            disabled={
              busy ||
              logoUploading ||
              closing ||
              accountState.status === "loading"
            }
            redirectNotice={githubPublishRedirect}
            onConfiguredChange={setGithubConfigured}
          />

          <details className="site-publish-advanced">
            <summary>
              <span>高级设置</span>
            </summary>
            <div className="site-publish-advanced-body">
            <section
              className="site-publish-card site-publish-settings"
              aria-label="网站设置"
            >
              <div className="site-publish-fields">
                <label className="site-publish-field">
                  <span>网站标题</span>
                  <input
                    type="text"
                    value={draft.settings.title}
                    maxLength={100}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateSettings({ title: event.target.value })
                    }
                  />
                </label>

                <label className="site-publish-field">
                  <span>网站简介</span>
                  <textarea
                    rows={3}
                    value={draft.settings.description}
                    maxLength={500}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      updateSettings({ description: event.target.value })
                    }
                  />
                </label>

                <label className="site-publish-field">
                  <span>站长名</span>
                  <input
                    type="text"
                    value={draft.settings.author}
                    maxLength={100}
                    placeholder="可选"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateSettings({ author: event.target.value })
                    }
                  />
                </label>

                <div className="site-publish-logo">
                  <div className="site-publish-logo-preview">
                    <img
                      src={logoPreviewSrc}
                      alt="网站 Logo 预览"
                      width={64}
                      height={64}
                      onError={() => setLogoPreviewError(true)}
                    />
                  </div>
                  <div className="site-publish-logo-copy">
                    <strong>网站 Logo</strong>
                    {logoPreviewError ? (
                      <p
                        className="site-publish-field-error site-publish-logo-error"
                        role="alert"
                      >
                        Logo 预览加载失败。请重新上传图片，或恢复默认 Logo。
                      </p>
                    ) : null}
                    {logoUploading ? (
                      <p className="site-publish-logo-status" role="status">
                        正在上传并保存网站 Logo，完成后才能生成网站…
                      </p>
                    ) : null}
                    <div className="site-publish-logo-actions">
                      <input
                        ref={logoInputRef}
                        id={logoInputId}
                        className="site-publish-visually-hidden"
                        type="file"
                        hidden
                        tabIndex={-1}
                        aria-label="选择网站 Logo 图片"
                        accept={SITE_LOGO_ACCEPT}
                        onChange={(event) =>
                          void handleLogoFileChange(event)
                        }
                        disabled={logoUploading}
                      />
                      <button
                        type="button"
                        className="site-publish-secondary"
                        disabled={logoUploading}
                        onClick={() => logoInputRef.current?.click()}
                      >
                        {hasCustomLogo ? "更换图片" : "上传图片"}
                      </button>
                      {hasCustomLogo ? <button
                        type="button"
                        className="site-publish-secondary"
                        onClick={restoreDefaultLogo}
                      >
                        恢复默认
                      </button> : null}
                    </div>
                  </div>
                </div>

                <label className="site-publish-field">
                  <span>站点域名（可选）</span>
                  <input
                    type="url"
                    inputMode="url"
                    value={draft.settings.origin}
                    placeholder="留空则按当前域名部署"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateSettings({ origin: event.target.value })
                    }
                  />
                </label>

                <label className="site-publish-field">
                  <span>部署子路径（basePath）</span>
                  <input
                    type="text"
                    value={draft.settings.basePath}
                    placeholder="/blog/"
                    aria-invalid={Boolean(basePathError)}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateSettings({ basePath: event.target.value })
                    }
                  />
                  <small>例如部署到 /blog/ 时填写 /blog/；根域名填写 /。</small>
                  {basePathError ? (
                    <small className="site-publish-field-error" role="alert">
                      {basePathError}
                    </small>
                  ) : null}
                </label>
              </div>

              {addressPreview.address ? (
                <p className="site-publish-address">
                  {addressPreview.hasOrigin ? "最终访问地址：" : "部署路径："}
                  <code>{addressPreview.address}</code>
                </p>
              ) : (
                <p className="site-publish-address-error" role="alert">
                  无法生成最终访问地址：{addressPreview.error}
                  请修正后重试，系统不会自动回退到默认路径。
                </p>
              )}

              {SITE_THEMES.length > 1 ? (
                <fieldset className="site-publish-theme">
                  <legend>网站样式</legend>
                  {SITE_THEMES.map((theme) => {
                    const optionId = `${themeId}-${theme.id}`;

                    return (
                      <div className="site-publish-theme-option" key={theme.id}>
                        <input
                          id={optionId}
                          type="radio"
                          name="site-publish-theme"
                          value={theme.id}
                          checked={draft.settings.themeId === theme.id}
                          onChange={() =>
                            updateSettings({
                              themeId: theme.id as SiteSettings["themeId"],
                            })
                          }
                        />
                        <label htmlFor={optionId}>{theme.label}</label>
                        <span>{theme.description}</span>
                      </div>
                    );
                  })}
                </fieldset>
              ) : null}
            </section>

            <section
              className="site-publish-card site-publish-categories"
              aria-labelledby={categoriesHeadingId}
            >
              <header className="site-publish-card-head">
                <h3 id={categoriesHeadingId}>分类设置</h3>
              </header>

              <ul className="site-publish-category-list">
                {draft.categories.map((category) => (
                  <li className="site-publish-category-row" key={category.id}>
                    <div className="site-publish-category-inputs">
                      <label>
                        <span>名称</span>
                        <input
                          type="text"
                          value={category.name}
                          maxLength={30}
                          aria-label={`分类名称：${category.name || "未命名"}`}
                          onChange={(event) =>
                            updateCategory(category.id, {
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>路径（slug）</span>
                        <input
                          type="text"
                          value={category.slug}
                          maxLength={48}
                          aria-label={`分类路径：${category.name || "未命名"}`}
                          onChange={(event) =>
                            updateCategory(category.id, {
                              slug: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    {isDefaultCategory(category) ? (
                      <span className="site-publish-badge">默认</span>
                    ) : (
                      <button
                        type="button"
                        className="site-publish-remove"
                        aria-label={`移除分类：${category.name || "未命名"}`}
                        onClick={() => removeCategory(category)}
                      >
                        移除
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <p className="site-publish-hint">
                分类路径以小写字母开头，只能包含小写字母、数字和短横线；移除仍有已选便签的分类前需先解除选择。
              </p>
            </section>

            </div>
          </details>
        </fieldset>
        </div>

        <footer className="site-publish-footer">
          <div className="site-publish-footer-copy">
            <p
              className={`site-publish-storage-note${
                accountState.status === "error" || accountState.status === "conflict" ? " is-unavailable" : ""
              }`}
              data-site-publish-storage={storageState}
              data-site-publish-sync={accountState.status}
            >
              {accountState.status === "loading" ? "正在读取账号设置…"
                : accountState.status === "saving" ? "正在保存…"
                : accountState.status === "saved" ? "已保存到账号"
                : accountState.status === "conflict" ? "其他设备更新了设置，请选择保留哪份。"
                : `${accountState.error} ${storageState === "saved" ? "修改已暂存本机。" : "修改尚未保存。"}`}
            </p>
            {accountState.status === "error" ? <button type="button" className="site-publish-secondary" onClick={() => void accountSyncRef.current?.retry()}>重试同步</button> : null}
            {accountState.status === "conflict" ? <div className="site-publish-sync-actions">
              <button type="button" className="site-publish-secondary" onClick={() => accountSyncRef.current?.useAccount()}>使用账号设置</button>
              <button type="button" className="site-publish-secondary" onClick={() => void accountSyncRef.current?.keepCurrent()}>保留当前设置</button>
            </div> : null}
          </div>
          <div className="site-publish-actions">
            <button
              type="button"
              className={githubConfigured ? "site-publish-secondary" : "site-publish-primary"}
              disabled={!canExport}
              onClick={() => void handleExport()}
            >
              {busy
                ? "正在生成…"
                : logoUploading
                  ? "等待 Logo 上传…"
                  : "生成网站 ZIP"}
            </button>
          </div>
          {busy ? (
            <p className="site-publish-status" role="status">
              正在生成网站…
            </p>
          ) : null}
          {error ? (
            <p className="site-publish-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="site-publish-notice" role="status">
              {notice}
            </p>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
