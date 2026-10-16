/** Scroll → pipeline LoadMode. Thresholds tuned on the real gallery grid. */

export type ScrollLoadMode = "idle" | "scrolling" | "fastScrolling";

/** Enter FastScrolling above this smoothed px/s. */
export const FAST_ENTER_PX_S = 2500;
/** Leave FastScrolling below this smoothed px/s (hysteresis). */
export const FAST_EXIT_PX_S = 1200;
export const SCROLL_IDLE_MS = 200;
const VELOCITY_EMA = 0.35;

export type ScrollModeState = {
  mode: ScrollLoadMode;
  ahead: -1 | 0 | 1;
  velocity: number;
  lastTs: number;
};

export function initialScrollModeState(): ScrollModeState {
  return { mode: "idle", ahead: 0, velocity: 0, lastTs: 0 };
}

/**
 * Update smoothed velocity / mode from a scrollTop sample.
 * Returns the next state; caller should IPC only when mode or ahead changed.
 */
export function advanceScrollMode(
  state: ScrollModeState,
  top: number,
  previousTop: number,
  nowMs: number,
): ScrollModeState {
  const ahead: -1 | 0 | 1 =
    top > previousTop + 1 ? 1 : top < previousTop - 1 ? -1 : state.ahead;
  // First sample after idle: enter Scrolling only — velocity needs a second tick for Fast.
  if (state.lastTs <= 0) {
    const instant = Math.abs(top - previousTop) * (1000 / 16);
    return { mode: "scrolling", ahead, velocity: instant, lastTs: nowMs };
  }
  const dt = Math.max(1, nowMs - state.lastTs);
  const instant = (Math.abs(top - previousTop) / dt) * 1000;
  const velocity = state.velocity * (1 - VELOCITY_EMA) + instant * VELOCITY_EMA;

  let mode: ScrollLoadMode = "scrolling";
  if (state.mode === "fastScrolling") {
    mode = velocity < FAST_EXIT_PX_S ? "scrolling" : "fastScrolling";
  } else if (velocity >= FAST_ENTER_PX_S) {
    mode = "fastScrolling";
  }

  return { mode, ahead, velocity, lastTs: nowMs };
}
