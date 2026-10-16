import type { FullscreenWindowBridge } from "./appFullscreenBridge.ts";
import {
  FULLSCREEN_SETTLE_TIMEOUT_MS,
  FULLSCREEN_STABLE_MS,
} from "./appFullscreenMotion.ts";

export type SettleSignal = {
  cancelled: boolean;
};

/**
 * Wait until OS fullscreen matches the target and inner size stops changing.
 * Resolves on timeout rather than hanging the UI.
 */
export async function waitForWindowSettle(
  bridge: FullscreenWindowBridge,
  expectFullscreen: boolean,
  signal: SettleSignal,
  options?: {
    stableMs?: number;
    timeoutMs?: number;
  },
): Promise<{ width: number; height: number }> {
  const stableMs = options?.stableMs ?? FULLSCREEN_STABLE_MS;
  const timeoutMs = options?.timeoutMs ?? FULLSCREEN_SETTLE_TIMEOUT_MS;

  let last = bridge.innerSize();
  let stableSince = performance.now();
  const started = performance.now();

  const matches = async () => {
    if (signal.cancelled) {
      return true;
    }
    const fs = await bridge.isFullscreen();
    const size = bridge.innerSize();
    if (size.width !== last.width || size.height !== last.height) {
      last = size;
      stableSince = performance.now();
    }
    const fsOk = fs === expectFullscreen;
    const stable = performance.now() - stableSince >= stableMs;
    const timedOut = performance.now() - started >= timeoutMs;
    return (fsOk && stable) || timedOut;
  };

  if (await matches()) {
    return last;
  }

  return new Promise((resolve) => {
    let finished = false;
    let unlisten: (() => void) | null = null;
    let intervalId = 0;
    let timeoutId = 0;

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
      unlisten?.();
      resolve(bridge.innerSize());
    };

    const tick = () => {
      void matches().then((done) => {
        if (done) {
          finish();
        }
      });
    };

    intervalId = window.setInterval(tick, 32);
    timeoutId = window.setTimeout(finish, timeoutMs);
    void bridge.onResized(() => tick()).then((stop) => {
      if (finished) {
        stop();
        return;
      }
      unlisten = stop;
    });
    tick();
  });
}
