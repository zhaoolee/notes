export const PROMO_CANVAS_WIDTH = 2048;
export const PROMO_CANVAS_HEIGHT = 920;

export interface PromoCrop {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface PromoPoint {
  x: number;
  y: number;
}

export interface PromoPageGeometry {
  bottomLeft: PromoPoint;
  topLeft: PromoPoint;
  topRight: PromoPoint;
}

export interface PromoImagePlacement {
  destination: PromoCrop;
  source: PromoCrop;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getPromoCoverCrop(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
): PromoCrop {
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return { height: 0, width: 0, x: 0, y: 0 };
  }

  const imageRatio = imageWidth / imageHeight;
  const frameRatio = frameWidth / frameHeight;
  let width = imageWidth;
  let height = imageHeight;

  if (imageRatio > frameRatio) {
    width = imageHeight * frameRatio;
  } else {
    height = imageWidth / frameRatio;
  }

  const safeZoom = clamp(zoom, 1, 2.5);
  width /= safeZoom;
  height /= safeZoom;

  const normalizedOffsetX = clamp(offsetX, -1, 1);
  const normalizedOffsetY = clamp(offsetY, -1, 1);
  const x = ((imageWidth - width) * (normalizedOffsetX + 1)) / 2;
  const y = ((imageHeight - height) * (normalizedOffsetY + 1)) / 2;

  return { height, width, x, y };
}

export function getPromoFitWidthPlacement(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  verticalPosition = 0,
): PromoImagePlacement {
  const emptyPlacement = {
    destination: { height: 0, width: 0, x: 0, y: 0 },
    source: { height: 0, width: 0, x: 0, y: 0 },
  };

  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    return emptyPlacement;
  }

  const scale = frameWidth / imageWidth;
  const renderedHeight = imageHeight * scale;

  if (renderedHeight <= frameHeight) {
    return {
      destination: {
        height: renderedHeight,
        width: frameWidth,
        x: 0,
        y: 0,
      },
      source: { height: imageHeight, width: imageWidth, x: 0, y: 0 },
    };
  }

  const visibleSourceHeight = frameHeight / scale;
  const maximumSourceY = imageHeight - visibleSourceHeight;

  return {
    destination: {
      height: frameHeight,
      width: frameWidth,
      x: 0,
      y: 0,
    },
    source: {
      height: visibleSourceHeight,
      width: imageWidth,
      x: 0,
      y: maximumSourceY * clamp(verticalPosition, 0, 1),
    },
  };
}

export function getPromoTransformedImagePlacement(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  logicalWidth: number,
  logicalHeight: number,
  fit: "cover" | "contain",
  offsetY = 0,
): PromoImagePlacement {
  const emptyPlacement = {
    destination: { height: 0, width: 0, x: 0, y: 0 },
    source: { height: 0, width: 0, x: 0, y: 0 },
  };

  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    logicalWidth <= 0 ||
    logicalHeight <= 0
  ) {
    return emptyPlacement;
  }

  if (fit === "cover") {
    return {
      destination: {
        height: logicalHeight,
        width: logicalWidth,
        x: 0,
        y: 0,
      },
      source: getPromoCoverCrop(
        imageWidth,
        imageHeight,
        frameWidth,
        frameHeight,
        1,
        0,
        offsetY,
      ),
    };
  }

  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const renderedWidth = imageWidth * scale;
  const renderedHeight = imageHeight * scale;

  return {
    destination: {
      height: (renderedHeight / frameHeight) * logicalHeight,
      width: (renderedWidth / frameWidth) * logicalWidth,
      x: ((frameWidth - renderedWidth) / 2 / frameWidth) * logicalWidth,
      y: ((frameHeight - renderedHeight) / 2 / frameHeight) * logicalHeight,
    },
    source: { height: imageHeight, width: imageWidth, x: 0, y: 0 },
  };
}

export function getPromoDownloadName(mode: "editor" | "pages"): string {
  return `notes-promo-${mode}-${PROMO_CANVAS_WIDTH}x${PROMO_CANVAS_HEIGHT}.png`;
}

export function normalizePromoHexColor(value: string): string | null {
  const trimmedValue = value.trim();
  const hexValue = trimmedValue.startsWith("#")
    ? trimmedValue.slice(1)
    : trimmedValue;

  if (!/^[0-9a-f]{6}$/i.test(hexValue)) {
    return null;
  }

  return `#${hexValue.toLowerCase()}`;
}

export function movePromoItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  const nextItems = [...items];

  if (
    fromIndex < 0 ||
    fromIndex >= nextItems.length ||
    toIndex < 0 ||
    toIndex >= nextItems.length ||
    fromIndex === toIndex
  ) {
    return nextItems;
  }

  const removedItems = nextItems.splice(fromIndex, 1);

  if (removedItems.length > 0) {
    nextItems.splice(toIndex, 0, removedItems[0] as T);
  }

  return nextItems;
}

export function scalePromoPageGeometry(
  topLeft: PromoPoint,
  topRight: PromoPoint,
  bottomLeft: PromoPoint,
  widthScale: number,
  heightScale: number,
): PromoPageGeometry {
  const safeWidthScale = clamp(widthScale, 0.25, 3);
  const safeHeightScale = clamp(heightScale, 0.25, 3);

  return {
    topLeft,
    topRight: {
      x: topLeft.x + (topRight.x - topLeft.x) * safeWidthScale,
      y: topLeft.y + (topRight.y - topLeft.y) * safeWidthScale,
    },
    bottomLeft: {
      x: topLeft.x + (bottomLeft.x - topLeft.x) * safeHeightScale,
      y: topLeft.y + (bottomLeft.y - topLeft.y) * safeHeightScale,
    },
  };
}

export function getPromoPageAspectHeightScale(
  topLeft: PromoPoint,
  topRight: PromoPoint,
  bottomLeft: PromoPoint,
  imageAspectRatio: number,
): number {
  const width = Math.hypot(
    topRight.x - topLeft.x,
    topRight.y - topLeft.y,
  );
  const height = Math.hypot(
    bottomLeft.x - topLeft.x,
    bottomLeft.y - topLeft.y,
  );

  if (width <= 0 || height <= 0 || !Number.isFinite(imageAspectRatio)) {
    return 1;
  }

  const safeAspectRatio = clamp(imageAspectRatio, 0.45, 2.4);
  return clamp(width / safeAspectRatio / height, 0.25, 3);
}
