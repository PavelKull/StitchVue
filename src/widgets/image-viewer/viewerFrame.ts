const VIEWER_PAD = 32;

export function aspectFromMeta(meta: { width: number; height: number } | undefined): number {
  if (meta && meta.height > 0) {
    return meta.width / meta.height;
  }
  return 1;
}

export function aspectFromSize(width: number, height: number): number {
  if (height > 0) {
    return width / height;
  }
  return 1;
}

/** Как в первом просмотрщике: вписать в окно с отступами. */
function fitInWindow(
  aspect: number,
  viewW: number,
  viewH: number,
  zoomScale: number,
): { width: number; height: number } {
  const maxW = Math.max(1, viewW - VIEWER_PAD * 2);
  const maxH = Math.max(1, viewH - VIEWER_PAD * 2);
  const scale = Math.max(0.25, zoomScale);

  let width: number;
  let height: number;

  if (aspect >= maxW / maxH) {
    width = maxW;
    height = maxW / aspect;
  } else {
    width = maxH * aspect;
    height = maxH;
  }

  return { width: width * scale, height: height * scale };
}

/** Режим «По экрану»: вертикаль — на всю высоту, горизонталь — на всю ширину. */
function fillViewport(
  aspect: number,
  viewW: number,
  viewH: number,
  zoomScale: number,
): { width: number; height: number } {
  const maxW = Math.max(1, viewW);
  const maxH = Math.max(1, viewH);
  const scale = Math.max(0.25, zoomScale);

  let width: number;
  let height: number;

  if (aspect >= maxW / maxH) {
    width = maxW;
    height = maxW / aspect;
  } else {
    width = maxH * aspect;
    height = maxH;
  }

  return { width: width * scale, height: height * scale };
}

export function computeViewerFrame(
  aspect: number,
  viewW: number,
  viewH: number,
  fillScreen: boolean,
  zoomScale: number,
): { width: number; height: number } {
  if (fillScreen) {
    return fillViewport(aspect, viewW, viewH, zoomScale);
  }
  return fitInWindow(aspect, viewW, viewH, zoomScale);
}
