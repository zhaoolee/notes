import { useEffect, useId, useRef, useState } from "react";
import { saveBlob } from "../lib/export.js";
import type { XArticleImage } from "../lib/x-article.js";

const imageExtensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

function XArticleImageRow({ image }: { image: XArticleImage }) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  async function handleSave() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveFailed(false);

    try {
      const response = await fetch(image.url);
      if (!response.ok) {
        throw new Error("Image request failed");
      }

      const blob = await response.blob();
      const extension = imageExtensions.get(blob.type);
      if (!extension || blob.size === 0) {
        throw new Error("Unsupported image file");
      }

      const index = String(image.number).padStart(2, "0");
      await saveBlob(blob, `x-article-image-${index}.${extension}`);
    } catch {
      setSaveFailed(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <li className="x-article-image">
      <img src={image.url} alt="" loading="lazy" />
      <div>
        <strong>{image.marker}</strong>
        {image.alt && image.alt !== "📷" ? <span>{image.alt}</span> : null}
        {saveFailed ? (
          <p role="alert">
            保存失败，可<a href={image.url} target="_blank" rel="noreferrer">打开原图</a>手动保存。
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`保存图片 ${image.number}`}
        aria-disabled={isSaving}
        onClick={handleSave}
      >
        {isSaving ? "正在保存…" : "保存图片"}
      </button>
    </li>
  );
}

export function XArticleImagesDialog({
  images,
  onClose,
}: {
  images: XArticleImage[];
  onClose: () => void;
}) {
  const titleId = useId();
  const guideId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="ai-review-dialog x-article-images-dialog"
      aria-labelledby={titleId}
      aria-describedby={guideId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="ai-review-header">
        <div>
          <h2 id={titleId}>正文已复制</h2>
          <p id={guideId}>
            粘贴到 X 后，在每个图片标记处选择 Insert → Media，上传对应的图片，再删除标记。
          </p>
        </div>
        <button type="button" aria-label="关闭 X 文章图片" onClick={onClose}>×</button>
      </header>
      <div className="ai-review-body">
        <ul className="x-article-image-list">
          {images.map((image) => <XArticleImageRow key={image.number} image={image} />)}
        </ul>
      </div>
    </dialog>
  );
}
