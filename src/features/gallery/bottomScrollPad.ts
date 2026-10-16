/** Зазор между верхом панели и низом последнего ряда (кнопки на плитке). */
export const BOTTOM_SCROLL_PAD_GAP_PX = 12;

/** Сколько места нужно снизу viewport, чтобы панель не накрывала последний ряд. */
export function bottomScrollPadNeeded(
  dockHeight: number,
  edgePx: number,
  gapPx = BOTTOM_SCROLL_PAD_GAP_PX,
): number {
  if (dockHeight <= 0) {
    return 0;
  }
  return Math.max(0, dockHeight) + Math.max(0, edgePx) + Math.max(0, gapPx);
}

/**
 * Фактический end-pad для scroll container.
 * Не создаёт лишнюю прокрутку, если контент и так заканчивается выше зоны панели.
 */
export function resolveBottomScrollPad(
  needed: number,
  contentHeight: number,
  viewportHeight: number,
): number {
  if (needed <= 0 || viewportHeight <= 0) {
    return 0;
  }
  const overflow = contentHeight - viewportHeight;
  if (overflow >= 0) {
    return needed;
  }
  return Math.max(0, needed - -overflow);
}
