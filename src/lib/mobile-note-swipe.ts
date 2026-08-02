export const MOBILE_NOTE_SWIPE_OPEN_OFFSET = 66;
export const MOBILE_NOTE_SWIPE_OPEN_THRESHOLD = 28;
export const MOBILE_NOTE_SWIPE_AXIS_LOCK_THRESHOLD = 6;

export type MobileNoteSwipeAxis = "pending" | "horizontal" | "vertical";

export function getMobileNoteSwipeAxis(
  deltaX: number,
  deltaY: number,
): MobileNoteSwipeAxis {
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (
    Math.max(horizontalDistance, verticalDistance) <
    MOBILE_NOTE_SWIPE_AXIS_LOCK_THRESHOLD
  ) {
    return "pending";
  }

  return horizontalDistance > verticalDistance * 1.15
    ? "horizontal"
    : "vertical";
}

export function getMobileNoteSwipeOffset(
  startOffset: number,
  deltaX: number,
): number {
  return Math.min(
    MOBILE_NOTE_SWIPE_OPEN_OFFSET,
    Math.max(0, startOffset + deltaX),
  );
}

export function shouldOpenMobileNoteSwipe(offset: number): boolean {
  return offset >= MOBILE_NOTE_SWIPE_OPEN_THRESHOLD;
}
