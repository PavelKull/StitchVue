/** Ширина окна, при которой chrome совпадает с исходными px-токенами. */
export const UI_REF_WIDTH_PX = 1920;

/** Нижняя граница коэффициента (см. --pg-ui-scale-min в _design-tokens.scss). */
export const UI_SCALE_MIN = 0.72;

/** Коэффициент масштабирования chrome; та же формула, что у --pg-ui-scale на .shell. */
export function uiScaleForViewportWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return 1;
  }
  const raw = widthPx / UI_REF_WIDTH_PX;
  return Math.min(1, Math.max(UI_SCALE_MIN, raw));
}

function resolveViewportWidth(widthPx?: number): number {
  if (widthPx != null && Number.isFinite(widthPx) && widthPx > 0) {
    return widthPx;
  }
  if (typeof window !== 'undefined' && Number.isFinite(window.innerWidth)) {
    return window.innerWidth;
  }
  return UI_REF_WIDTH_PX;
}

/** Масштабирует эталонное значение chrome (px при scale 1). */
export function scaleChromePx(basePx: number, widthPx?: number): number {
  return Math.round(basePx * uiScaleForViewportWidth(resolveViewportWidth(widthPx)));
}
