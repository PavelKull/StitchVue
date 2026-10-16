/** Opt-in: `localStorage.setItem('stitchvue.fsDiag', '1')` then reload. */

export type FsDiagSample = {
  label: string;
  t: number;
  innerWidth: number;
  innerHeight: number;
  data?: Record<string, unknown>;
};

const KEY = "stitchvue.fsDiag";

export function fsDiagEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let marks: FsDiagSample[] = [];
let rafId = 0;
let rafLast = 0;
let rafGaps: number[] = [];
let sessionStart = 0;

export function fsDiagBegin(sessionLabel: string): void {
  if (!fsDiagEnabled()) {
    return;
  }
  marks = [];
  rafGaps = [];
  sessionStart = performance.now();
  fsDiagMark(`begin:${sessionLabel}`);
  stopRafSampler();
  rafLast = performance.now();
  const tick = (now: number) => {
    if (rafLast > 0) {
      rafGaps.push(now - rafLast);
    }
    rafLast = now;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function fsDiagMark(label: string, data?: Record<string, unknown>): void {
  if (!fsDiagEnabled()) {
    return;
  }
  marks.push({
    label,
    t: performance.now() - sessionStart,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    data,
  });
}

export function fsDiagEnd(sessionLabel: string): void {
  if (!fsDiagEnabled()) {
    return;
  }
  fsDiagMark(`end:${sessionLabel}`);
  stopRafSampler();
  const gaps = rafGaps.slice(1);
  const maxGap = gaps.reduce((a, b) => Math.max(a, b), 0);
  const meanGap =
    gaps.length === 0 ? 0 : gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const summary = {
    sessionLabel,
    marks,
    rafFrames: gaps.length,
    maxGapMs: Number(maxGap.toFixed(2)),
    meanGapMs: Number(meanGap.toFixed(2)),
    droppedGuess: gaps.filter((g) => g > 24).length,
  };
  console.info("[stitchvue.fsDiag]", summary);
  try {
    (
      window as unknown as { __stitchvueFsDiag?: unknown }
    ).__stitchvueFsDiag = summary;
  } catch {
    // ignore
  }
}

function stopRafSampler(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  rafLast = 0;
}
