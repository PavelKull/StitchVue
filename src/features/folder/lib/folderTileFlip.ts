/** Capture tile screen rects keyed by folder path for a FLIP after list reorder. */
export function captureFolderTileRects(grid: HTMLElement): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  for (const el of grid.querySelectorAll<HTMLElement>("[data-folder-path]")) {
    const path = el.dataset.folderPath;
    if (!path) {
      continue;
    }
    map.set(path, el.getBoundingClientRect());
  }
  return map;
}

/**
 * After React commits a new folder order, invert existing tiles to their previous
 * positions and ease them to the new layout. Entering tiles (no prior rect) are skipped.
 */
export function playFolderTileFlip(
  grid: HTMLElement,
  previous: Map<string, DOMRect>,
  durationMs: number,
  easing = "cubic-bezier(0.22, 1, 0.36, 1)",
): void {
  const playing: HTMLElement[] = [];
  for (const el of grid.querySelectorAll<HTMLElement>("[data-folder-path]")) {
    const path = el.dataset.folderPath;
    if (!path) {
      continue;
    }
    const first = previous.get(path);
    if (!first) {
      continue;
    }
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      continue;
    }
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    playing.push(el);
  }
  if (playing.length === 0) {
    return;
  }
  void grid.offsetWidth;
  for (const el of playing) {
    el.style.transition = `transform ${durationMs}ms ${easing}`;
    el.style.transform = "";
  }
  window.setTimeout(() => {
    for (const el of playing) {
      el.style.transition = "";
      el.style.transform = "";
    }
  }, durationMs + 48);
}
