export const VIEWER_SLOW_MS = 500;
export const VIEWER_FAST_MS = 180;
export const VIEWER_AHEAD_SLOW = 4;
export const VIEWER_AHEAD_NORMAL = 5;
export const VIEWER_AHEAD_FAST = 12;

/** Smooths recent navigation intervals so one fast keypress does not change the plan. */
export function smoothInterval(intervals: readonly number[]): number | null {
  if (intervals.length === 0) {
    return null;
  }
  let value = intervals[0];
  for (let index = 1; index < intervals.length; index += 1) {
    value = value * 0.65 + intervals[index] * 0.35;
  }
  return value;
}

export function aheadForInterval(intervalMs: number | null): number {
  if (intervalMs == null || intervalMs > VIEWER_SLOW_MS) {
    return intervalMs == null ? VIEWER_AHEAD_NORMAL : VIEWER_AHEAD_SLOW;
  }
  if (intervalMs < VIEWER_FAST_MS) {
    return VIEWER_AHEAD_FAST;
  }
  return VIEWER_AHEAD_NORMAL;
}

export function isFastPace(intervalMs: number | null): boolean {
  return intervalMs != null && intervalMs < VIEWER_FAST_MS;
}
