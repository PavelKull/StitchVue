/**
 * Experimental harness — does not replace `useAppFullscreen`.
 *
 * DevTools:
 *   await window.__stitchvuePrototypeAnim({ expand: true, mode: 'workArea' })
 *   await window.__stitchvuePrototypeAnim({ expand: false, mode: 'workArea' })
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PrototypeFillMode = "workArea" | "monitor" | "borderlessMonitor";

export type PrototypeAnimRequest = {
  expand: boolean;
  mode: PrototypeFillMode;
  durationMs?: number;
};

export type PrototypeAnimReport = {
  ok: boolean;
  expand: boolean;
  mode: PrototypeFillMode;
  durationMs: number;
  frameCount: number;
  maxGapMs: number;
  meanGapMs: number;
  dpi: number;
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number; width: number; height: number };
  notes: string[];
};

export async function runPrototypeWindowAnim(
  request: PrototypeAnimRequest,
): Promise<PrototypeAnimReport> {
  return invoke<PrototypeAnimReport>("prototype_window_anim", { request });
}

export async function listenPrototypeAnimSamples(
  onSample: (sample: {
    t: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void,
): Promise<UnlistenFn> {
  return listen("window-anim-sample", (event) => {
    onSample(event.payload as {
      t: number;
      x: number;
      y: number;
      width: number;
      height: number;
    });
  });
}

declare global {
  interface Window {
    __stitchvuePrototypeAnim?: (
      request: PrototypeAnimRequest,
    ) => Promise<PrototypeAnimReport>;
  }
}

/** Install console helper once (dev research). */
export function installPrototypeAnimConsoleHelper(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__stitchvuePrototypeAnim = (request) => runPrototypeWindowAnim(request);
}
