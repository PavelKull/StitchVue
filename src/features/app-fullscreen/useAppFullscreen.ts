import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  getAppFullscreenController,
  type FullscreenPhase,
} from "./appFullscreenController.ts";

export type UseAppFullscreenResult = {
  enabled: boolean;
  phase: FullscreenPhase;
  target: boolean | null;
  bottomInset: number;
  transitioning: boolean;
  toggle: () => void;
  setEnabled: (enabled: boolean) => void;
};

export function useAppFullscreen(options?: {
  getAnimationsEnabled?: () => boolean;
}): UseAppFullscreenResult {
  const controller = getAppFullscreenController();

  useEffect(() => {
    if (options?.getAnimationsEnabled) {
      controller.setAnimationsEnabledGetter(options.getAnimationsEnabled);
    }
  }, [controller, options?.getAnimationsEnabled]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let active = true;
    void controller.start().then((dispose) => {
      if (!active) {
        dispose();
        return;
      }
      stop = dispose;
    });
    return () => {
      active = false;
      stop?.();
    };
  }, [controller]);

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const toggle = useCallback(() => {
    void controller.toggle();
  }, [controller]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      void controller.setEnabled(enabled);
    },
    [controller],
  );

  return {
    enabled: snapshot.enabled,
    phase: snapshot.phase,
    target: snapshot.target,
    bottomInset: snapshot.bottomInset,
    transitioning: snapshot.phase !== "idle",
    toggle,
    setEnabled,
  };
}
