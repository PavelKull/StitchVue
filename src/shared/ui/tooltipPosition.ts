const VIEWPORT_PAD = 8;
const GAP = 8;

export type TooltipPlacement = "above" | "below";

export type TooltipCoords = {
  left: number;
  top: number;
  placement: TooltipPlacement;
};

export function placeTooltipInViewport(
  anchor: DOMRect,
  tipWidth: number,
  tipHeight: number,
  preferred: TooltipPlacement,
  viewport?: { width: number; height: number },
): TooltipCoords {
  const vw = viewport?.width ?? window.innerWidth;
  const vh = viewport?.height ?? window.innerHeight;
  let placement = preferred;
  let top =
    placement === "above" ? anchor.top - GAP - tipHeight : anchor.bottom + GAP;

  if (placement === "above" && top < VIEWPORT_PAD) {
    placement = "below";
    top = anchor.bottom + GAP;
  } else if (placement === "below" && top + tipHeight > vh - VIEWPORT_PAD) {
    placement = "above";
    top = anchor.top - GAP - tipHeight;
  }

  top = Math.min(vh - VIEWPORT_PAD - tipHeight, Math.max(VIEWPORT_PAD, top));

  const centerX = anchor.left + anchor.width / 2;
  const half = tipWidth / 2;
  let left = centerX;
  if (centerX - half < VIEWPORT_PAD) {
    left = VIEWPORT_PAD + half;
  } else if (centerX + half > vw - VIEWPORT_PAD) {
    left = vw - VIEWPORT_PAD - half;
  }

  return { left, top, placement };
}
