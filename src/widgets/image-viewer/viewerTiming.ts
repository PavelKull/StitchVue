export type ViewerTimings = {
  firstFrameMs: number | null;
  qualityFrameMs: number | null;
  webviewDecodeMs: number | null;
};

let openedAt = 0;
let current: ViewerTimings = {
  firstFrameMs: null,
  qualityFrameMs: null,
  webviewDecodeMs: null,
};

export function markViewerOpened(): void {
  openedAt = performance.now();
  current = { firstFrameMs: null, qualityFrameMs: null, webviewDecodeMs: null };
}

export function markFirstFrame(): void {
  if (openedAt === 0 || current.firstFrameMs !== null) {
    return;
  }
  current = { ...current, firstFrameMs: performance.now() - openedAt };
}

export function markQualityFrame(): void {
  if (openedAt === 0) {
    return;
  }
  current = { ...current, qualityFrameMs: performance.now() - openedAt };
}

export function markWebviewDecode(ms: number): void {
  current = { ...current, webviewDecodeMs: ms };
}

export function viewerTimings(): ViewerTimings {
  return current;
}
