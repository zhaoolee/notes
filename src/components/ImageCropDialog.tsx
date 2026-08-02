import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

interface CropRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface ImageCropDialogProps {
  alt: string;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void>;
  source: string;
}

type CropDragMode = "move" | "ne" | "nw" | "se" | "sw";

interface CropDragState {
  crop: CropRect;
  imageHeight: number;
  imageWidth: number;
  mode: CropDragMode;
  pointerId: number;
  startX: number;
  startY: number;
}

const MIN_CROP_SIZE = 0.08;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function resizeCrop(
  original: CropRect,
  mode: Exclude<CropDragMode, "move">,
  deltaX: number,
  deltaY: number,
): CropRect {
  let left = original.x;
  let top = original.y;
  let right = original.x + original.width;
  let bottom = original.y + original.height;

  if (mode.includes("w")) {
    left = clamp(original.x + deltaX, 0, right - MIN_CROP_SIZE);
  } else {
    right = clamp(right + deltaX, left + MIN_CROP_SIZE, 1);
  }

  if (mode.includes("n")) {
    top = clamp(original.y + deltaY, 0, bottom - MIN_CROP_SIZE);
  } else {
    bottom = clamp(bottom + deltaY, top + MIN_CROP_SIZE, 1);
  }

  return {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  };
}

export function ImageCropDialog({
  alt,
  onCancel,
  onConfirm,
  source,
}: ImageCropDialogProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<CropDragState | null>(null);
  const [crop, setCrop] = useState<CropRect>({
    height: 0.8,
    width: 0.8,
    x: 0.1,
    y: 0.1,
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onCancel]);

  function beginCropDrag(
    event: ReactPointerEvent<HTMLElement>,
    mode: CropDragMode,
  ): void {
    const imageBounds = imageWrapRef.current?.getBoundingClientRect();

    if (!imageBounds || imageBounds.width <= 0 || imageBounds.height <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      crop,
      imageHeight: imageBounds.height,
      imageWidth: imageBounds.width,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handleCropPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = (event.clientX - drag.startX) / drag.imageWidth;
    const deltaY = (event.clientY - drag.startY) / drag.imageHeight;

    if (drag.mode === "move") {
      setCrop({
        ...drag.crop,
        x: clamp(drag.crop.x + deltaX, 0, 1 - drag.crop.width),
        y: clamp(drag.crop.y + deltaY, 0, 1 - drag.crop.height),
      });
      return;
    }

    setCrop(resizeCrop(drag.crop, drag.mode, deltaX, deltaY));
  }

  function finishCropDrag(event: ReactPointerEvent<HTMLElement>): void {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  async function confirmCrop(): Promise<void> {
    const image = imageRef.current;

    if (!image?.naturalWidth || !image.naturalHeight) {
      setError("图片还没有加载完成，请稍后再试。");
      return;
    }

    const sourceX = Math.round(crop.x * image.naturalWidth);
    const sourceY = Math.round(crop.y * image.naturalHeight);
    const sourceWidth = Math.max(1, Math.round(crop.width * image.naturalWidth));
    const sourceHeight = Math.max(1, Math.round(crop.height * image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      setError("当前浏览器无法裁剪图片。");
      return;
    }

    try {
      setIsSaving(true);
      setError("");
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("图片裁剪失败。")),
          "image/png",
        );
      });
      await onConfirm(
        new File([blob], `cropped-${Date.now()}.png`, { type: "image/png" }),
      );
    } catch (cropError) {
      setError(
        cropError instanceof Error ? cropError.message : "图片裁剪失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return createPortal(
    <div className="image-crop-backdrop" role="presentation">
      <section
        className="image-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-crop-title"
      >
        <header className="image-crop-header">
          <button type="button" disabled={isSaving} onClick={onCancel}>
            取消
          </button>
          <h2 id="image-crop-title">裁剪图片</h2>
          <button
            type="button"
            className="is-primary"
            disabled={isSaving}
            onClick={() => void confirmCrop()}
          >
            {isSaving ? "保存中…" : "完成"}
          </button>
        </header>

        <div className="image-crop-stage">
          <div ref={imageWrapRef} className="image-crop-canvas">
            <img
              ref={imageRef}
              src={source}
              alt={alt || "待裁剪图片"}
              crossOrigin="anonymous"
            />
            <div
              className="image-crop-selection"
              style={{
                height: `${crop.height * 100}%`,
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
              }}
              onPointerDown={(event) => beginCropDrag(event, "move")}
              onPointerMove={handleCropPointerMove}
              onPointerUp={finishCropDrag}
              onPointerCancel={finishCropDrag}
            >
              {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                <button
                  key={corner}
                  type="button"
                  className={`image-crop-handle is-${corner}`}
                  aria-label={`调整裁剪区域 ${corner}`}
                  onPointerDown={(event) => beginCropDrag(event, corner)}
                  onPointerMove={handleCropPointerMove}
                  onPointerUp={finishCropDrag}
                  onPointerCancel={finishCropDrag}
                />
              ))}
            </div>
          </div>
        </div>

        {error ? <p className="image-crop-error">{error}</p> : null}
      </section>
    </div>,
    document.body,
  );
}
