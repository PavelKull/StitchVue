export const VIEWER_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
export const VIEWER_MAX_EDGE = 8192;

export function viewerNeededEdge(frameWidth: number, frameHeight: number, pixelRatio: number): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const edge = Math.ceil(Math.max(frameWidth, frameHeight) * ratio);
  if (!Number.isFinite(edge) || edge < 256) {
    return 256;
  }
  return Math.min(VIEWER_MAX_EDGE, edge);
}

export function viewerZoomIndex(scale: number): number {
  const index = VIEWER_ZOOM_STEPS.indexOf(scale);
  if (index === -1) {
    const near = VIEWER_ZOOM_STEPS.findIndex((step) => step >= scale);
    return near === -1 ? VIEWER_ZOOM_STEPS.length - 1 : near;
  }
  return index;
}

export function viewerZoomFromIndex(index: number): number {
  return VIEWER_ZOOM_STEPS[Math.min(VIEWER_ZOOM_STEPS.length - 1, Math.max(0, index))];
}
