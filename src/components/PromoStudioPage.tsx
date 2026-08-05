import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  getPromoDownloadName,
  getPromoFitWidthPlacement,
  getPromoPageAspectHeightScale,
  getPromoTransformedImagePlacement,
  movePromoItem,
  normalizePromoHexColor,
  PROMO_CANVAS_HEIGHT,
  PROMO_CANVAS_WIDTH,
  scalePromoPageGeometry,
  type PromoPoint,
} from "../lib/promo-image.js";

type PromoMode = "editor" | "pages";
type PageImageFit = "cover" | "contain";

interface PromoStudioPageProps {
  mode: PromoMode;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const FONT_FAMILY = 'OPPOSans, "PingFang SC", "Microsoft YaHei", sans-serif';
const PROMO_SCRIPT_TEXTURE = "/promo-script-texture.png";
const PAGE_LAYER_NAMES = ["前层", "中层", "后层"] as const;

const INITIAL_COPY: Record<PromoMode, { body: string; title: string }> = {
  editor: {
    title: "每一次修改，\n都让表达更准确",
    body: "上传你的产品截图，突出编辑、校对或创作功能。调整文案与构图后，一键导出高清宣传图。",
  },
  pages: {
    title: "可能是史上最漂亮的\n便签应用",
    body: "你或许会因它重新喜欢上记录和表达。它不仅可以输入文字，还支持插入图片，进行图文混排",
  },
};

function createRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height,
  );
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): number {
  const requestedLines = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  for (const requestedLine of requestedLines) {
    if (!requestedLine) {
      lines.push("");
      continue;
    }

    let line = "";

    for (const character of Array.from(requestedLine)) {
      const candidate = `${line}${character}`;

      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trimEnd());
        line = character.trimStart();
      } else {
        line = candidate;
      }
    }

    lines.push(line.trimEnd());
  }

  const visibleLines = lines.slice(0, maxLines);

  if (lines.length > maxLines && visibleLines.length > 0) {
    let lastLine = visibleLines[visibleLines.length - 1];

    while (
      lastLine.length > 0 &&
      context.measureText(`${lastLine}…`).width > maxWidth
    ) {
      lastLine = lastLine.slice(0, -1);
    }

    visibleLines[visibleLines.length - 1] = `${lastLine}…`;
  }

  visibleLines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });

  return y + visibleLines.length * lineHeight;
}

function drawEditorPlaceholder(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.fillStyle = "#f7f7f6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, 70);
  context.strokeStyle = "#e7e7e5";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, 70);
  context.lineTo(width, 70);
  context.stroke();

  ["#ff5f57", "#febc2e", "#28c840"].forEach((color, index) => {
    context.fillStyle = color;
    context.beginPath();
    context.arc(30 + index * 30, 35, 9, 0, Math.PI * 2);
    context.fill();
  });

  context.fillStyle = "#f2f2f0";
  context.fillRect(width - 280, 70, 280, height - 70);
  context.strokeStyle = "#e4e4e1";
  context.beginPath();
  context.moveTo(width - 280, 70);
  context.lineTo(width - 280, height);
  context.stroke();

  context.fillStyle = "#2f302f";
  context.font = `500 20px ${FONT_FAMILY}`;
  const sampleLines = [
    "把零散的灵感，整理成清晰的表达。",
    "写作并不是一口气抵达终点，",
    "而是在一次次修改中找到更准确的词。",
    "让结构更自然，让重点更醒目，",
    "让每一句话都忠于你真正想说的事。",
    "",
    "今天，从记录第一句话开始。",
  ];

  sampleLines.forEach((line, index) => {
    context.fillText(line, 82, 126 + index * 48);
  });

  context.fillStyle = "#b9b9b6";
  context.font = `400 17px ${FONT_FAMILY}`;
  Array.from({ length: 12 }, (_, index) => {
    context.fillText(
      index % 3 === 0 ? "建议优化这一处表达" : "文字与样式检查",
      width - 250,
      125 + index * 39,
    );
  });
}

function drawDocumentPlaceholder(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  index: number,
): void {
  const headings = ["写作，从一个念头开始", "第一章：介绍", "把故事带到远方"];

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#151515";
  context.font = `700 ${index === 2 ? 37 : 32}px ${FONT_FAMILY}`;
  drawWrappedText(context, headings[index] ?? headings[0], 58, 100, width - 116, 46, 3);
  context.strokeStyle = "#242424";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(58, 190);
  context.lineTo(width - 58, 190);
  context.stroke();

  context.fillStyle = "#343434";
  context.font = `400 16px ${FONT_FAMILY}`;
  const copy =
    "当文字从草稿变成作品，每一处细节都会拥有新的意义。清晰的层次、舒适的留白和恰当的节奏，让读者愿意继续读下去。";
  let copyY = 248;

  for (let paragraph = 0; paragraph < 5; paragraph += 1) {
    copyY = drawWrappedText(context, copy, 58, copyY, width - 116, 28, 4) + 30;
  }

  context.fillStyle = index === 2 ? "#c9d8df" : "#e9e7e1";
  context.fillRect(58, Math.min(copyY + 10, height - 230), width - 116, 150);
}

function drawScriptDecoration(
  context: CanvasRenderingContext2D,
  texture: HTMLImageElement | null,
): void {
  context.save();

  if (texture) {
    context.globalAlpha = 0.58;
    context.drawImage(texture, -18, 105, 720, 544);
    context.drawImage(texture, -12, 520, 720, 544);
    context.globalAlpha = 1;
  } else {
    context.strokeStyle = "rgba(200, 183, 176, 0.38)";
    context.lineCap = "round";
    context.lineWidth = 3;

    for (let row = 0; row < 7; row += 1) {
      const y = 145 + row * 92;
      context.beginPath();
      context.moveTo(-18, y + 25);
      context.bezierCurveTo(50, y - 28, 96, y + 38, 154, y - 5);
      context.bezierCurveTo(190, y - 34, 205, y + 18, 265, y - 12);
      context.bezierCurveTo(320, y - 43, 360, y + 27, 430, y - 6);
      context.stroke();
    }
  }

  context.strokeStyle = "rgba(200, 183, 176, 0.38)";
  context.lineCap = "round";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(1260, 780);
  context.bezierCurveTo(1360, 832, 1425, 746, 1470, 790);
  context.bezierCurveTo(1500, 820, 1430, 846, 1555, 833);
  context.bezierCurveTo(1620, 825, 1695, 760, 1640, 792);
  context.bezierCurveTo(1590, 830, 1775, 845, 2020, 810);
  context.stroke();
  context.restore();
}

function drawPromoCopy(
  context: CanvasRenderingContext2D,
  mode: PromoMode,
  title: string,
  body: string,
): void {
  const x = mode === "editor" ? 1315 : 198;
  const titleY = mode === "editor" ? 190 : 205;
  const titleWidth = mode === "editor" ? 585 : 600;

  context.fillStyle = "#ffffff";
  context.textBaseline = "alphabetic";
  context.font = `700 66px ${FONT_FAMILY}`;
  const titleBottom = drawWrappedText(
    context,
    title,
    x,
    titleY,
    titleWidth,
    72,
    4,
  );

  context.fillStyle = "rgba(255, 255, 255, 0.82)";
  context.font = `400 27px ${FONT_FAMILY}`;
  drawWrappedText(
    context,
    body,
    x,
    Math.max(mode === "editor" ? 402 : 425, titleBottom + 54),
    mode === "editor" ? 590 : 610,
    42,
    6,
  );
}

function drawEditorPromo(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  title: string,
  body: string,
  background: string,
  verticalPosition: number,
  scriptTexture: HTMLImageElement | null,
): void {
  context.fillStyle = background;
  context.fillRect(0, 0, PROMO_CANVAS_WIDTH, PROMO_CANVAS_HEIGHT);
  drawScriptDecoration(context, scriptTexture);

  const frame = { height: 820, width: 1035, x: 200, y: 175 };
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.28)";
  context.shadowBlur = 40;
  context.shadowOffsetY = 18;
  context.fillStyle = "#ffffff";
  createRoundedRectPath(context, frame.x, frame.y, frame.width, frame.height, 34);
  context.fill();
  context.restore();

  context.save();
  createRoundedRectPath(context, frame.x, frame.y, frame.width, frame.height, 34);
  context.clip();

  if (image) {
    context.fillStyle = "#ffffff";
    context.fillRect(frame.x, frame.y, frame.width, frame.height);
    const placement = getPromoFitWidthPlacement(
      image.naturalWidth,
      image.naturalHeight,
      frame.width,
      frame.height,
      verticalPosition,
    );

    context.drawImage(
      image,
      placement.source.x,
      placement.source.y,
      placement.source.width,
      placement.source.height,
      frame.x + placement.destination.x,
      frame.y + placement.destination.y,
      placement.destination.width,
      placement.destination.height,
    );
  } else {
    context.translate(frame.x, frame.y);
    drawEditorPlaceholder(context, frame.width, frame.height);
  }

  context.restore();
  drawPromoCopy(context, "editor", title, body);
}

function drawTransformedPage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  imageFit: PageImageFit,
  index: number,
  topLeft: PromoPoint,
  topRight: PromoPoint,
  bottomLeft: PromoPoint,
  pageWidth: number,
  pageHeight: number,
  widthScale: number,
  heightScale: number,
  imageAspectRatio: number | null,
  imageOffsetY: number,
): void {
  const aspectHeightScale = imageAspectRatio
    ? getPromoPageAspectHeightScale(
        topLeft,
        topRight,
        bottomLeft,
        imageAspectRatio,
      )
    : 1;
  const geometry = scalePromoPageGeometry(
    topLeft,
    topRight,
    bottomLeft,
    widthScale,
    heightScale * aspectHeightScale,
  );
  const frameWidth = Math.hypot(
    geometry.topRight.x - geometry.topLeft.x,
    geometry.topRight.y - geometry.topLeft.y,
  );
  const frameHeight = Math.hypot(
    geometry.bottomLeft.x - geometry.topLeft.x,
    geometry.bottomLeft.y - geometry.topLeft.y,
  );

  context.save();
  context.transform(
    (geometry.topRight.x - geometry.topLeft.x) / pageWidth,
    (geometry.topRight.y - geometry.topLeft.y) / pageWidth,
    (geometry.bottomLeft.x - geometry.topLeft.x) / pageHeight,
    (geometry.bottomLeft.y - geometry.topLeft.y) / pageHeight,
    geometry.topLeft.x,
    geometry.topLeft.y,
  );
  context.shadowColor = "rgba(0, 0, 0, 0.24)";
  context.shadowBlur = 32;
  context.shadowOffsetX = -14;
  context.shadowOffsetY = 22;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, pageWidth, pageHeight);
  context.shadowColor = "transparent";
  context.beginPath();
  context.rect(0, 0, pageWidth, pageHeight);
  context.clip();

  if (image) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageWidth, pageHeight);

    const placement = getPromoTransformedImagePlacement(
      image.naturalWidth,
      image.naturalHeight,
      frameWidth,
      frameHeight,
      pageWidth,
      pageHeight,
      imageFit,
      imageOffsetY,
    );

    context.drawImage(
      image,
      placement.source.x,
      placement.source.y,
      placement.source.width,
      placement.source.height,
      placement.destination.x,
      placement.destination.y,
      placement.destination.width,
      placement.destination.height,
    );
  } else {
    drawDocumentPlaceholder(context, pageWidth, pageHeight, index);
  }

  if (index < 2) {
    const gradient = context.createLinearGradient(0, 0, pageWidth, 0);
    gradient.addColorStop(0, "rgba(40, 40, 40, 0.05)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.16)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, pageWidth, pageHeight);
  }

  context.restore();
}

function drawPagesPromo(
  context: CanvasRenderingContext2D,
  images: Array<HTMLImageElement | null>,
  imageFit: PageImageFit,
  widthScale: number,
  heightScale: number,
  imageAspectRatio: number | null,
  imageOffsetsY: readonly number[],
  title: string,
  body: string,
  background: string,
): void {
  context.fillStyle = background;
  context.fillRect(0, 0, PROMO_CANVAS_WIDTH, PROMO_CANVAS_HEIGHT);
  drawPromoCopy(context, "pages", title, body);

  drawTransformedPage(
    context,
    images[2] ?? null,
    imageFit,
    0,
    { x: 880, y: 345 },
    { x: 1450, y: 398 },
    { x: 905, y: 1085 },
    570,
    740,
    widthScale,
    heightScale,
    imageAspectRatio,
    imageOffsetsY[2] ?? -1,
  );
  drawTransformedPage(
    context,
    images[1] ?? null,
    imageFit,
    1,
    { x: 1168, y: 278 },
    { x: 1788, y: 338 },
    { x: 1212, y: 1098 },
    620,
    820,
    widthScale,
    heightScale,
    imageAspectRatio,
    imageOffsetsY[1] ?? -1,
  );
  drawTransformedPage(
    context,
    images[0] ?? null,
    imageFit,
    2,
    { x: 1515, y: 202 },
    { x: 2035, y: 250 },
    { x: 1570, y: 1080 },
    520,
    878,
    widthScale,
    heightScale,
    imageAspectRatio,
    imageOffsetsY[0] ?? -1,
  );
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.src = source;
  });
}

function isSupportedImage(file: File): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

export function PromoStudioPage({ mode }: PromoStudioPageProps) {
  const initialCopy = INITIAL_COPY[mode];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [title, setTitle] = useState(initialCopy.title);
  const [body, setBody] = useState(initialCopy.body);
  const [background, setBackground] = useState("#3b3a38");
  const [backgroundInput, setBackgroundInput] = useState("#3b3a38");
  const [imageSources, setImageSources] = useState<Array<string | null>>([
    null,
    null,
    null,
  ]);
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [images, setImages] = useState<Array<HTMLImageElement | null>>([
    null,
    null,
    null,
  ]);
  const [scriptTexture, setScriptTexture] = useState<HTMLImageElement | null>(null);
  const [editorVerticalPosition, setEditorVerticalPosition] = useState(0);
  const [pageImageFit, setPageImageFit] = useState<PageImageFit>("contain");
  const [pageWidthPercent, setPageWidthPercent] = useState(100);
  const [pageHeightPercent, setPageHeightPercent] = useState(100);
  const [pageVerticalPositions, setPageVerticalPositions] = useState<
    [number, number, number]
  >([0, 0, 0]);
  const [isPageAspectAutomatic, setIsPageAspectAutomatic] = useState(true);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "ready">("idle");
  const firstImageAspectRatio = images[0]
    ? images[0].naturalWidth / images[0].naturalHeight
    : null;

  useLayoutEffect(() => {
    document.documentElement.classList.add("promo-studio-active");
    document.body.classList.add("promo-studio-active");

    return () => {
      document.documentElement.classList.remove("promo-studio-active");
      document.body.classList.remove("promo-studio-active");
    };
  }, []);

  useEffect(() => {
    if (mode !== "editor") {
      setScriptTexture(null);
      return;
    }

    let cancelled = false;

    loadImage(PROMO_SCRIPT_TEXTURE)
      .then((texture) => {
        if (!cancelled) {
          setScriptTexture(texture);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setScriptTexture(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      imageSources.map(async (source) => (source ? await loadImage(source) : null)),
    )
      .then((loadedImages) => {
        if (!cancelled) {
          setImages(loadedImages);
          setError("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("图片读取失败，请换一张 PNG、JPG 或 WebP 图片重试。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imageSources]);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      await document.fonts?.ready;

      if (cancelled) {
        return;
      }

      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");

      if (!canvas || !context) {
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);

      if (mode === "editor") {
        drawEditorPromo(
          context,
          images[0] ?? null,
          title,
          body,
          background,
          editorVerticalPosition / 100,
          scriptTexture,
        );
      } else {
        drawPagesPromo(
          context,
          images,
          pageImageFit,
          pageWidthPercent / 100,
          pageHeightPercent / 100,
          isPageAspectAutomatic ? firstImageAspectRatio : null,
          pageVerticalPositions.map((position) => position / 50 - 1),
          title,
          body,
          background,
        );
      }
    };

    void render();

    return () => {
      cancelled = true;
    };
  }, [
    background,
    body,
    editorVerticalPosition,
    images,
    isPageAspectAutomatic,
    mode,
    pageImageFit,
    pageHeightPercent,
    pageVerticalPositions,
    pageWidthPercent,
    scriptTexture,
    title,
  ]);

  const applyFiles = async (files: File[]) => {
    const maximumFiles = mode === "editor" ? 1 : 3;
    const selectedFiles = files.slice(0, maximumFiles);

    if (selectedFiles.length === 0) {
      return;
    }

    const invalidFile = selectedFiles.find(
      (file) => !isSupportedImage(file) || file.size > MAX_IMAGE_BYTES,
    );

    if (invalidFile) {
      setError("仅支持 20MB 以内的 PNG、JPG 或 WebP 图片。");
      return;
    }

    try {
      const sources = await Promise.all(selectedFiles.map(readFileAsDataUrl));
      setImageSources([
        sources[0] ?? null,
        sources[1] ?? null,
        sources[2] ?? null,
      ]);
      setImageNames(selectedFiles.map((file) => file.name));
      setEditorVerticalPosition(0);
      setPageVerticalPositions([0, 0, 0]);
      setError("");
    } catch {
      setError("图片读取失败，请重新选择。");
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void applyFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void applyFiles(Array.from(event.dataTransfer.files));
  };

  const resetImages = () => {
    setImageSources([null, null, null]);
    setImageNames([]);
    setImages([null, null, null]);
    setEditorVerticalPosition(0);
    setPageVerticalPositions([0, 0, 0]);
    setError("");
  };

  const movePageImage = (fromIndex: number, direction: -1 | 1) => {
    const toIndex = fromIndex + direction;

    if (toIndex < 0 || toIndex >= imageNames.length) {
      return;
    }

    setImageSources((sources) => movePromoItem(sources, fromIndex, toIndex));
    setImageNames((names) => movePromoItem(names, fromIndex, toIndex));
    setImages((loadedImages) =>
      movePromoItem(loadedImages, fromIndex, toIndex),
    );
    setPageVerticalPositions((positions) =>
      movePromoItem(positions, fromIndex, toIndex) as [number, number, number],
    );
  };

  const downloadPng = () => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        setError("生成图片失败，请刷新页面后重试。");
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = getPromoDownloadName(mode);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setDownloadState("ready");
      window.setTimeout(() => setDownloadState("idle"), 1_800);
    }, "image/png");
  };

  const isEditor = mode === "editor";
  const modeName = isEditor ? "单图聚焦" : "多页层叠";

  return (
    <div className="promo-studio-page">
      <header className="promo-studio-header">
        <div className="promo-studio-brand">
          <a href="/" className="promo-home-link" aria-label="返回锤子便签">
            <span className="promo-brand-dot" aria-hidden="true" />
            宣传截图工坊
          </a>
          <span className="promo-mode-name">{modeName}</span>
        </div>

        <nav className="promo-mode-tabs" aria-label="宣传图模板">
          <a
            href="/promo/editor"
            className={isEditor ? "is-active" : undefined}
            aria-current={isEditor ? "page" : undefined}
          >
            单图聚焦
          </a>
          <a
            href="/promo/pages"
            className={!isEditor ? "is-active" : undefined}
            aria-current={!isEditor ? "page" : undefined}
          >
            多页层叠
          </a>
        </nav>

        <button type="button" className="promo-download-button" onClick={downloadPng}>
          {downloadState === "ready" ? "已生成 PNG" : "下载高清 PNG"}
        </button>
      </header>

      <main className="promo-studio-main">
        <aside className="promo-controls" aria-label={`${modeName}设置`}>
          <div>
            <span className="promo-controls-eyebrow">内容</span>
            <h1>{modeName}</h1>
            <p>成品尺寸固定为 2048 × 920 px，适合官网横幅和社交媒体宣传。</p>
          </div>

          <label className="promo-control-field">
            <span>主标题</span>
            <textarea
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              rows={3}
              maxLength={52}
            />
          </label>

          <label className="promo-control-field">
            <span>说明文字</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              maxLength={150}
            />
          </label>

          <label className="promo-color-field">
            <span>背景颜色</span>
            <span className="promo-color-control">
              <input
                type="color"
                value={background}
                onChange={(event) => {
                  const nextColor = event.target.value.toLowerCase();
                  setBackground(nextColor);
                  setBackgroundInput(nextColor);
                }}
                aria-label="选择宣传图背景颜色"
              />
              <input
                className="promo-color-text-input"
                type="text"
                value={backgroundInput}
                maxLength={7}
                spellCheck={false}
                onChange={(event) => {
                  const nextInput = event.target.value;
                  const nextColor = normalizePromoHexColor(nextInput);
                  setBackgroundInput(nextInput);

                  if (nextColor) {
                    setBackground(nextColor);
                  }
                }}
                onBlur={() => {
                  const normalizedColor = normalizePromoHexColor(backgroundInput);
                  setBackgroundInput(normalizedColor ?? background);
                }}
                aria-label="输入十六进制背景颜色"
                aria-invalid={
                  backgroundInput.length === 7 &&
                  normalizePromoHexColor(backgroundInput) === null
                }
              />
            </span>
          </label>

          <div
            className={`promo-upload-zone${isDragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <span className="promo-upload-icon" aria-hidden="true">＋</span>
            <strong>{isEditor ? "上传产品截图" : "上传 1–3 张页面图"}</strong>
            <span>支持 PNG、JPG、WebP，单张不超过 20MB</span>
            <input
              className="promo-file-input"
              type="file"
              accept={IMAGE_ACCEPT}
              multiple={!isEditor}
              onChange={handleFileChange}
              aria-label={isEditor ? "选择产品截图" : "选择最多三张页面图片"}
            />
            <small>图片仅在本机浏览器中处理，不会上传服务器</small>
          </div>

          {imageNames.length > 0 && isEditor ? (
            <div className="promo-selected-images">
              <span>{imageNames.join(" · ")}</span>
              <button type="button" onClick={resetImages}>移除图片</button>
            </div>
          ) : null}

          {imageNames.length > 0 && !isEditor ? (
            <fieldset className="promo-image-order">
              <legend>图片顺序</legend>
              <div className="promo-image-order-heading">
                <small>第一张显示在最前层</small>
                <button type="button" onClick={resetImages}>移除全部</button>
              </div>
              <div className="promo-image-order-list">
                {imageNames.map((name, index) => {
                  const layerName = PAGE_LAYER_NAMES[index] ?? "页面";

                  return (
                    <div className="promo-image-order-row" key={`${name}-${index}`}>
                      <span className="promo-image-order-index">{index + 1}</span>
                      <span className="promo-image-order-copy">
                        <strong>{layerName}</strong>
                        <small title={name}>{name}</small>
                      </span>
                      <span className="promo-image-order-actions">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => movePageImage(index, -1)}
                          aria-label={`将${name}移到前一层`}
                        >
                          前移
                        </button>
                        <button
                          type="button"
                          disabled={index === imageNames.length - 1}
                          onClick={() => movePageImage(index, 1)}
                          aria-label={`将${name}移到后一层`}
                        >
                          后移
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {isEditor ? (
            <fieldset className="promo-image-adjustments">
              <legend>图片位置</legend>
              <label>
                <span>上下取景</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={editorVerticalPosition}
                  disabled={!imageSources[0]}
                  onChange={(event) =>
                    setEditorVerticalPosition(Number(event.target.value))
                  }
                  aria-label="调整单图的上下取景"
                />
                <output>
                  {editorVerticalPosition === 0
                    ? "顶部"
                    : editorVerticalPosition === 100
                      ? "底部"
                      : `${editorVerticalPosition}%`}
                </output>
              </label>
              <small>图片始终完整显示宽度，从顶部向下取景</small>
            </fieldset>
          ) : (
            <fieldset className="promo-fit-choice">
              <legend>图片适配</legend>
              <label className={pageImageFit === "cover" ? "is-active" : undefined}>
                <input
                  type="radio"
                  name="page-image-fit"
                  value="cover"
                  checked={pageImageFit === "cover"}
                  onChange={() => setPageImageFit("cover")}
                />
                <span>
                  <strong>铺满页面</strong>
                  <small>自动裁切空白，适合横向截图</small>
                </span>
              </label>
              <label className={pageImageFit === "contain" ? "is-active" : undefined}>
                <input
                  type="radio"
                  name="page-image-fit"
                  value="contain"
                  checked={pageImageFit === "contain"}
                  onChange={() => setPageImageFit("contain")}
                />
                <span>
                  <strong>完整显示</strong>
                  <small>保留整张图片，空余区域显示为白色</small>
                </span>
              </label>
              <div className="promo-cover-positions">
                <div className="promo-cover-positions-heading">
                  <strong>每张图单独取景</strong>
                  <small>
                    {pageImageFit === "cover"
                      ? "默认从顶部开始，可分别向下移动"
                      : "切换到“铺满页面”后可调节"}
                  </small>
                </div>
                {pageVerticalPositions.map((position, index) => {
                  const layerName = PAGE_LAYER_NAMES[index] ?? "页面";
                  const isEnabled =
                    pageImageFit === "cover" && Boolean(imageSources[index]);

                  return (
                    <div
                      className={`promo-cover-position${
                        isEnabled ? "" : " is-disabled"
                      }`}
                      key={layerName}
                    >
                      <div>
                        <strong>图片 {index + 1} · {layerName}</strong>
                        <output>
                          {position === 0
                            ? "顶部"
                            : position === 100
                              ? "底部"
                              : `${position}%`}
                        </output>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={position}
                        disabled={!isEnabled}
                        onChange={(event) => {
                          const nextPosition = Number(event.target.value);
                          setPageVerticalPositions((positions) => {
                            const nextPositions: [number, number, number] = [
                              ...positions,
                            ];
                            nextPositions[index] = nextPosition;
                            return nextPositions;
                          });
                        }}
                        aria-label={`调节图片 ${index + 1}（${layerName}）的上下取景`}
                      />
                      <small>{imageNames[index] ?? "尚未上传"}</small>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {!isEditor ? (
            <fieldset className="promo-page-size">
              <legend>纸张尺寸</legend>
              <label className="promo-aspect-toggle">
                <input
                  type="checkbox"
                  checked={isPageAspectAutomatic}
                  onChange={(event) => setIsPageAspectAutomatic(event.target.checked)}
                />
                <span>跟随第一张图比例</span>
                <output>
                  {firstImageAspectRatio
                    ? `${firstImageAspectRatio.toFixed(2)} : 1`
                    : "上传后自动"}
                </output>
              </label>
              <label>
                <span>统一宽度</span>
                <input
                  type="range"
                  min="60"
                  max="140"
                  step="2"
                  value={pageWidthPercent}
                  onChange={(event) => setPageWidthPercent(Number(event.target.value))}
                  aria-label="统一调节三张纸的宽度"
                />
                <output>{pageWidthPercent}%</output>
              </label>
              <label>
                <span>统一高度</span>
                <input
                  type="range"
                  min="60"
                  max="140"
                  step="2"
                  value={pageHeightPercent}
                  onChange={(event) => setPageHeightPercent(Number(event.target.value))}
                  aria-label="统一调节三张纸的高度"
                />
                <output>{pageHeightPercent}%</output>
              </label>
            </fieldset>
          ) : null}

          {error ? <p className="promo-error" role="alert">{error}</p> : null}
        </aside>

        <section
          className={`promo-preview-section${isDragging ? " is-dragging" : ""}`}
          aria-labelledby="promo-preview-title"
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <div className="promo-preview-heading">
            <div>
              <span>实时预览</span>
              <strong id="promo-preview-title">2048 × 920</strong>
            </div>
            <span>拖入图片也可以快速替换</span>
          </div>
          <div className="promo-canvas-frame">
            <canvas
              ref={canvasRef}
              width={PROMO_CANVAS_WIDTH}
              height={PROMO_CANVAS_HEIGHT}
              aria-label={`${modeName}宣传图预览`}
              role="img"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
