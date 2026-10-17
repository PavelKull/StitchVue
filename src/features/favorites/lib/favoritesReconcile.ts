/**
 * Debounced album-open favorites reconcile scheduler (CL-P01).
 * Invokes a caller-supplied star refetch — no new IPC.
 */

import { pathKey } from "../../selection/lib/selection.ts";

export const FAVORITES_RECONCILE_DEBOUNCE_MS = 400;
export const FAVORITES_RECONCILE_SKIP_WINDOW_MS = 2000;

export type FavoritesReconcileScheduleOptions = {
  force?: boolean;
};

export type FavoritesReconcileClock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

export type FavoritesReconcileScheduler = {
  schedule: (
    directoryKey: string,
    options?: FavoritesReconcileScheduleOptions,
  ) => void;
  cancel: () => void;
};

const defaultClock: FavoritesReconcileClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/** Schedules light star refetch; skips same directoryKey within 2s unless `force`. */
export function createFavoritesReconcileScheduler(
  onReconcile: (directoryKey: string) => void,
  clock: FavoritesReconcileClock = defaultClock,
  debounceMs: number = FAVORITES_RECONCILE_DEBOUNCE_MS,
  skipWindowMs: number = FAVORITES_RECONCILE_SKIP_WINDOW_MS,
): FavoritesReconcileScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingDirectory: string | null = null;
  let lastFiredKey: string | null = null;
  let lastFiredAt = 0;

  const cancel = () => {
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
    pendingDirectory = null;
  };

  return {
    schedule(directory, options) {
      const force = options?.force === true;
      const key = pathKey(directory);
      if (
        !force &&
        lastFiredKey === key &&
        clock.now() - lastFiredAt < skipWindowMs
      ) {
        return;
      }

      pendingDirectory = directory;
      if (timer !== null) {
        clock.clearTimeout(timer);
      }
      timer = clock.setTimeout(() => {
        timer = null;
        const path = pendingDirectory;
        pendingDirectory = null;
        if (path === null) {
          return;
        }
        lastFiredKey = pathKey(path);
        lastFiredAt = clock.now();
        onReconcile(path);
      }, debounceMs);
    },
    cancel,
  };
}
