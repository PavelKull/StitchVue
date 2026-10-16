/** Below this scroll offset the catalog is treated as sitting at the top. */
export const FOLDER_HEADER_TOP_PX = 4;

export function compensateHeaderScrollTop(
  previousScrollTop: number,
  previousHeaderHeight: number,
  nextHeaderHeight: number,
  maxScrollTop = Number.POSITIVE_INFINITY,
): number {
  if (previousScrollTop <= FOLDER_HEADER_TOP_PX) {
    return 0;
  }
  const next = previousScrollTop + (nextHeaderHeight - previousHeaderHeight);
  return Math.min(maxScrollTop, Math.max(0, next));
}
