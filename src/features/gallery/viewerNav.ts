export type BackgroundClick = "prev" | "next" | "close" | "none";

const NAV_EDGE_PX = 120;

/** Side gradient navigates. A click on the photo or the remaining dark backdrop closes. */
export function viewerBackgroundClick(
  clientX: number,
  frameLeft: number,
  frameRight: number,
  viewWidth: number,
  canPrev: boolean,
  canNext: boolean,
): BackgroundClick {
  if (clientX >= frameLeft && clientX <= frameRight) {
    return "close";
  }
  if (clientX <= NAV_EDGE_PX) {
    return canPrev ? "prev" : "none";
  }
  if (clientX >= viewWidth - NAV_EDGE_PX) {
    return canNext ? "next" : "none";
  }
  return "close";
}
