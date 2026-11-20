import { useEffect, useState, type ChangeEvent } from "react";
import type { NoteDocument } from "../../types/app.js";
import { getSiteNoteTitle, type SitePublishDraft } from "./model.js";

interface SitePublishContentProps {
  draft: SitePublishDraft;
  notes: NoteDocument[];
  newCategoryName: string;
  newCategorySlug: string;
  maxCategories: number;
  onNewCategoryNameChange: (value: string) => void;
  onNewCategorySlugChange: (value: string) => void;
  /** 返回 true 表示已校验并创建成功，新增行据此收起。 */
  onAddCategory: () => boolean;
  /** 便签已属于其他分类时移动到目标分类，不会重复发布。 */
  onAssignNote: (noteId: string, categoryId: string) => void;
  onRemoveNote: (noteId: string) => void;
}

function formatNoteDate(timestamp: number): string {
  try {
    return new Date(timestamp).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function matchesSearch(note: NoteDocument, keyword: string): boolean {
  if (!keyword) {
    return true;
  }

  const title = getSiteNoteTitle(note.markdown).toLocaleLowerCase("zh-CN");
  return (
    title.includes(keyword) ||
    note.markdown.toLocaleLowerCase("zh-CN").includes(keyword)
  );
}

/**
 * 网站发布面板的主内容：按网站分类分组展示已选便签，按需展开单组便签选择器。
 * 站点设置与分类改名/删除留在默认折叠的高级设置里，本组件只负责呈现与操作回调。
 */
export function SitePublishContent({
  draft,
  notes,
  newCategoryName,
  newCategorySlug,
  maxCategories,
  onNewCategoryNameChange,
  onNewCategorySlugChange,
  onAddCategory,
  onAssignNote,
  onRemoveNote,
}: SitePublishContentProps) {
  const [pickerCategoryId, setPickerCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  const liveNotes = notes.filter((note) => note.deletedAt === null);
  const noteById = new Map(liveNotes.map((note) => [note.id, note]));
  const categoryById = new Map(
    draft.categories.map((category) => [category.id, category]),
  );
  const categoryIdByNoteId = new Map(
    draft.selections.map((selection) => [
      selection.noteId,
      selection.categoryId,
    ]),
  );
  const keyword = search.trim().toLocaleLowerCase("zh-CN");
  const filteredNotes = liveNotes.filter((note) =>
    matchesSearch(note, keyword),
  );
  const canSubmitCategory =
    Boolean(newCategoryName.trim()) &&
    Boolean(newCategorySlug.trim()) &&
    draft.categories.length < maxCategories;

  // 分类可能在高级设置里被删除，避免选择器停留在不存在的分类上。
  useEffect(() => {
    if (
      pickerCategoryId &&
      !draft.categories.some((category) => category.id === pickerCategoryId)
    ) {
      setPickerCategoryId(null);
      setSearch("");
    }
  }, [draft.categories, pickerCategoryId]);

  function togglePicker(categoryId: string) {
    setPickerCategoryId((current) => current === categoryId ? null : categoryId);
    setSearch("");
  }

  function closePicker() {
    setPickerCategoryId(null);
    setSearch("");
  }

  function submitCategory() {
    if (!canSubmitCategory) {
      return;
    }

    if (onAddCategory()) {
      setAddingCategory(false);
    }
  }

  return (
    <div className="site-publish-content">
      <div className="site-publish-group-grid">
        {draft.categories.map((category) => {
          const selections = draft.selections
            .filter((selection) => selection.categoryId === category.id)
            .reverse();
          const pickerOpen = pickerCategoryId === category.id;

          return (
            <article
              className="site-publish-group"
              key={category.id}
              aria-label={`${category.name}分类`}
            >
              <header className="site-publish-group-head">
                <h3>{category.name}</h3>
                <span className="site-publish-group-count">
                  {selections.length} 张
                </span>
                <button
                  type="button"
                  className="site-publish-secondary site-publish-group-add"
                  aria-expanded={pickerOpen}
                  aria-label={`为「${category.name}」添加便签`}
                  onClick={() => togglePicker(category.id)}
                >
                  添加便签
                </button>
              </header>

              {selections.length > 0 ? (
                <ul className="site-publish-group-notes">
                  {selections.map((selection) => {
                    const note = noteById.get(selection.noteId);

                    if (!note) {
                      return null;
                    }

                    const title = getSiteNoteTitle(note.markdown);

                    return (
                      <li
                        className="site-publish-group-note"
                        key={selection.noteId}
                      >
                        <span className="site-publish-note-text">
                          <strong>{title}</strong>
                        </span>
                        <button
                          type="button"
                          className="site-publish-remove"
                          aria-label={`从「${category.name}」移除${title}`}
                          onClick={() => onRemoveNote(selection.noteId)}
                        >
                          移除
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {pickerOpen ? (
                <div className="site-publish-group-picker">
                  <div className="site-publish-note-tools">
                    <label className="site-publish-search">
                      <span className="site-publish-visually-hidden">
                        搜索便签
                      </span>
                      <input
                        type="search"
                        value={search}
                        placeholder="搜索标题或正文"
                        aria-label={`搜索可添加到「${category.name}」的便签`}
                        autoFocus
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setSearch(event.target.value)
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="site-publish-secondary"
                      onClick={closePicker}
                    >
                      完成
                    </button>
                  </div>

                  {liveNotes.length === 0 ? (
                    <p className="site-publish-empty">
                      还没有可发布的便签，先回到编辑区创建一篇吧。
                    </p>
                  ) : filteredNotes.length === 0 ? (
                    <p className="site-publish-empty">
                      没有匹配“{search.trim()}”的便签。
                    </p>
                  ) : (
                    <ul className="site-publish-note-list">
                      {filteredNotes.map((note) => {
                        const title = getSiteNoteTitle(note.markdown);
                        const currentCategoryId = categoryIdByNoteId.get(
                          note.id,
                        );
                        const currentCategory = currentCategoryId
                          ? categoryById.get(currentCategoryId)
                          : undefined;
                        const inThisCategory =
                          currentCategoryId === category.id;

                        return (
                          <li key={note.id}>
                            <label className="site-publish-note-row">
                              <input
                                type="checkbox"
                                checked={inThisCategory}
                                aria-label={title}
                                onChange={(event) =>
                                  event.target.checked
                                    ? onAssignNote(note.id, category.id)
                                    : onRemoveNote(note.id)
                                }
                              />
                              <span className="site-publish-note-text">
                                <strong>{title}</strong>
                                <small>
                                  {formatNoteDate(note.updatedAt)}
                                  {note.pinnedAt !== null ? " · 已置顶" : ""}
                                </small>
                              </span>
                              {currentCategory && !inThisCategory ? (
                                <span className="site-publish-note-badge">
                                  原分类：{currentCategory.name}
                                </span>
                              ) : null}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="site-publish-add-category">
        <button
          type="button"
          className="site-publish-secondary"
          aria-expanded={addingCategory}
          onClick={() => setAddingCategory((current) => !current)}
        >
          添加分类
        </button>

        {addingCategory ? (
          <div
            className="site-publish-category-add"
            role="group"
            aria-label="新增网站分类"
          >
            <label className="site-publish-field">
              <span>新分类名称</span>
              <input
                type="text"
                value={newCategoryName}
                maxLength={30}
                placeholder="例如：随笔"
                onChange={(event) => onNewCategoryNameChange(event.target.value)}
              />
            </label>
            <label className="site-publish-field">
              <span>分类路径（slug）</span>
              <input
                type="text"
                value={newCategorySlug}
                maxLength={48}
                placeholder="essay"
                onChange={(event) => onNewCategorySlugChange(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="site-publish-secondary"
              disabled={!canSubmitCategory}
              onClick={submitCategory}
            >
              创建分类
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
