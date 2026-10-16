import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Low-level Tauri fullscreen API.
 * UI transitions go through `AppFullscreenController` / `useAppFullscreen`.
 */
export async function setWindowFullscreen(enabled: boolean): Promise<void> {
  await getCurrentWindow().setFullscreen(enabled);
}

/** Компенсация появления/скрытия панели задач Windows после входа в fullscreen. */
export function measureFullscreenBottomInset(heightBeforeEnter: number): number {
  return Math.max(0, window.innerHeight - heightBeforeEnter);
}
