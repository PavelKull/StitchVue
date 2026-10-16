/** Panel opacity/transform window during fullscreen prepare (TZ: 150–220 ms). */
export const FULLSCREEN_PANEL_MS = 180;

/** Size must stay unchanged this long before settle completes. */
export const FULLSCREEN_STABLE_MS = 48;

/** Hard cap so a stuck OS resize cannot leave the UI mid-transition. */
export const FULLSCREEN_SETTLE_TIMEOUT_MS = 800;

export function resolvePanelMotionMs(
  animationsEnabled: boolean,
  reducedMotion: boolean,
): number {
  if (!animationsEnabled || reducedMotion) {
    return 0;
  }
  return FULLSCREEN_PANEL_MS;
}

export function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
