export const MODAL_MOTION_MS = 220;

export type ModalMotionPhase = "entering" | "open" | "exiting";

export function isModalMotionEnabled(): boolean {
  const shell = document.querySelector<HTMLElement>("[data-animations-enabled]");
  if (shell?.dataset.animationsEnabled === "false") {
    return false;
  }
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
