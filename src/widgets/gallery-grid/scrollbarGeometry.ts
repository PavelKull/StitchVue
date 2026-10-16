export const THUMB_WIDTH = 16.2;
export const THUMB_MIN = 37.8;
/** Same gap under the top limit and above the bottom limit. */
export const THUMB_END_GAP = 8;
export const THUMB_RIGHT = 18;
export const REVEAL_PX = 64;

export type RectLike = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type ScrollbarMetrics = {
  visible: boolean;
  thumbHeight: number;
  thumbTop: number;
  overflow: number;
  maxTravel: number;
};

export function inScrollbarRevealLane(
  x: number,
  y: number,
  lane: { top: number; bottom: number; right: number },
  revealPx = REVEAL_PX,
): boolean {
  return x >= lane.right - revealPx && x <= lane.right + 1 && y >= lane.top && y <= lane.bottom;
}

export function laneOverlaps(viewport: RectLike, obstacle: RectLike, lanePx = REVEAL_PX): boolean {
  const laneLeft = viewport.right - lanePx;
  if (obstacle.right <= laneLeft || obstacle.left >= viewport.right) {
    return false;
  }
  if (obstacle.bottom <= viewport.top || obstacle.top >= viewport.bottom) {
    return false;
  }
  return true;
}

/** Visual track only. Does not change the scrollport height. */
export function trackLimits(
  viewport: RectLike,
  obstacles: readonly { rect: RectLike; edge: "top" | "bottom" }[],
  lanePx = REVEAL_PX,
): { trackTop: number; trackBottom: number } {
  const height = Math.max(0, viewport.bottom - viewport.top);
  let trackTop = 0;
  let trackBottom = height;
  for (const item of obstacles) {
    if (!laneOverlaps(viewport, item.rect, lanePx)) {
      continue;
    }
    if (item.edge === "top") {
      trackTop = Math.max(trackTop, item.rect.bottom - viewport.top);
    } else {
      trackBottom = Math.min(trackBottom, item.rect.top - viewport.top);
    }
  }
  trackTop = Math.min(height, Math.max(0, trackTop));
  trackBottom = Math.min(height, Math.max(trackTop, trackBottom));
  return { trackTop, trackBottom };
}

export function scrollbarMetrics(input: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  trackTop: number;
  trackBottom: number;
}): ScrollbarMetrics {
  const scrollHeight = Math.max(0, input.scrollHeight);
  const clientHeight = Math.max(0, input.clientHeight);
  const overflow = Math.max(0, scrollHeight - clientHeight);
  const rawTop = Math.max(0, input.trackTop);
  const rawBottom = Math.max(rawTop, input.trackBottom);
  const gap = rawBottom - rawTop >= THUMB_END_GAP * 2 + THUMB_MIN ? THUMB_END_GAP : 0;
  const trackTop = rawTop + gap;
  const trackBottom = rawBottom - gap;
  const trackHeight = Math.max(0, trackBottom - trackTop);
  if (overflow <= 1 || trackHeight <= 0 || scrollHeight <= 0) {
    return { visible: false, thumbHeight: 0, thumbTop: trackTop, overflow, maxTravel: 0 };
  }
  const proportional = (trackHeight * clientHeight) / scrollHeight;
  let thumbHeight = Math.min(trackHeight, Math.max(THUMB_MIN, proportional));
  if (thumbHeight < THUMB_WIDTH && trackHeight >= THUMB_WIDTH) {
    thumbHeight = THUMB_WIDTH;
  }
  const maxTravel = Math.max(0, trackHeight - thumbHeight);
  const ratio = Math.min(1, Math.max(0, input.scrollTop / overflow));
  return {
    visible: true,
    thumbHeight,
    thumbTop: trackTop + ratio * maxTravel,
    overflow,
    maxTravel,
  };
}

export function scrollTopFromDrag(
  startScroll: number,
  deltaY: number,
  maxTravel: number,
  overflow: number,
): number {
  const limit = Math.max(0, overflow);
  if (limit === 0 || maxTravel <= 0) {
    return Math.min(limit, Math.max(0, startScroll));
  }
  const next = startScroll + (deltaY / maxTravel) * limit;
  return Math.min(limit, Math.max(0, next));
}
