import { getCurrentWindow } from "@tauri-apps/api/window";
import { setWindowFullscreen } from "./appFullscreenWindow.ts";

export type FullscreenWindowBridge = {
  setFullscreen(enabled: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
  innerSize(): { width: number; height: number };
};

export function createTauriFullscreenBridge(): FullscreenWindowBridge {
  return {
    setFullscreen: (enabled) => setWindowFullscreen(enabled),
    isFullscreen: () => getCurrentWindow().isFullscreen(),
    onResized: async (handler) => {
      const unlisten = await getCurrentWindow().onResized(() => {
        handler();
      });
      return unlisten;
    },
    innerSize: () => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }),
  };
}
