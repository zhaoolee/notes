import { useState } from "react";
import type { EditorImageUpload } from "../lib/editor-image-uploads";

export function EditorImageUploadPlaceholder({ upload, onRetry, onCancel }: {
  upload: EditorImageUpload;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const [aspectRatio, setAspectRatio] = useState("4 / 3");
  const name = typeof upload.source === "string" ? "链接图片" : upload.source.name;
  const label = upload.status === "queued" ? "排队中"
    : upload.status === "failed" ? "上传失败"
    : upload.previewUrl ? (upload.progress >= 99 ? "正在处理图片… 99%" : `上传中 ${upload.progress}%`)
    : "正在导入图片…";

  return (
    <figure className="editor-image-block editor-image-upload" data-upload-state={upload.status}>
      <div className="editor-image-upload-preview" style={{ aspectRatio }}>
        {upload.previewUrl ? (
          <img src={upload.previewUrl} alt="" loading="lazy" draggable={false}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth && naturalHeight) setAspectRatio(`${naturalWidth} / ${naturalHeight}`);
            }} />
        ) : null}
        <div className="editor-image-upload-overlay">
          <span className="editor-image-upload-name" title={name}>{name}</span>
          <span>{label}</span>
          {upload.status === "uploading" ? (
            <progress aria-label={`${name}上传进度`} max={100}
              value={upload.previewUrl ? upload.progress : undefined} />
          ) : null}
          {upload.status === "failed" ? <span className="editor-image-upload-error">{upload.error}</span> : null}
          <div className="editor-image-upload-buttons">
            {upload.status === "failed" ? <button type="button" onClick={onRetry}>重试</button> : null}
            <button type="button" onClick={onCancel}>{upload.status === "failed" ? "移除" : "取消"}</button>
          </div>
        </div>
      </div>
    </figure>
  );
}
