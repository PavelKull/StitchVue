export const TWO_PI = Math.PI * 2;

export const COMET_VIEW = 56;
export const COMET_CX = 28;
export const COMET_CY = 28;
export const COMET_RADIUS = 24.5;
export const COMET_HEAD_R = 1.85;
export const COMET_MIN_WIDTH = 0.4;
export const COMET_MAX_WIDTH = 3.15;
export const COMET_WIDTH_POWER = 1.4;
export const INDETERMINATE_SWEEP = 0.48;
export const MAX_LOADING_SWEEP = TWO_PI * 0.97;

export function cometWidth(
  t: number,
  minWidth: number,
  maxWidth: number,
  power = COMET_WIDTH_POWER,
): number {
  const u = Math.min(1, Math.max(0, t));
  return minWidth + (maxWidth - minWidth) * u ** power;
}

export function sweepFromRatio(ratio: number | null): number {
  if (ratio == null) {
    return INDETERMINATE_SWEEP;
  }
  const u = Math.min(1, Math.max(0, ratio));
  return INDETERMINATE_SWEEP + (MAX_LOADING_SWEEP - INDETERMINATE_SWEEP) * u;
}

function pointOnRing(
  cx: number,
  cy: number,
  radius: number,
  angleFromTopCw: number,
): { x: number; y: number } {
  return {
    x: cx + radius * Math.sin(angleFromTopCw),
    y: cy - radius * Math.cos(angleFromTopCw),
  };
}

export function cometHeadPoint(
  cx = COMET_CX,
  cy = COMET_CY,
  radius = COMET_RADIUS,
): { x: number; y: number } {
  return pointOnRing(cx, cy, radius, 0);
}

function ringPath(
  cx: number,
  cy: number,
  radius: number,
  width: number,
): string {
  const outer = radius + width / 2;
  const inner = Math.max(0.2, radius - width / 2);
  return [
    `M ${cx} ${cy - outer}`,
    `A ${outer} ${outer} 0 1 1 ${cx} ${cy + outer}`,
    `A ${outer} ${outer} 0 1 1 ${cx} ${cy - outer}`,
    "Z",
    `M ${cx} ${cy - inner}`,
    `A ${inner} ${inner} 0 1 0 ${cx} ${cy + inner}`,
    `A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner}`,
    "Z",
  ].join(" ");
}

export type CometTailParams = {
  cx?: number;
  cy?: number;
  radius?: number;
  sweepRad: number;
  minWidth: number;
  maxWidth: number;
  widthPower?: number;
  segments?: number;
};

export function buildCometTailPath(params: CometTailParams): string {
  const cx = params.cx ?? COMET_CX;
  const cy = params.cy ?? COMET_CY;
  const radius = params.radius ?? COMET_RADIUS;
  const sweep = Math.min(TWO_PI, Math.max(0.06, params.sweepRad));
  if (sweep >= TWO_PI - 0.002) {
    return ringPath(cx, cy, radius, params.maxWidth);
  }

  const power = params.widthPower ?? COMET_WIDTH_POWER;
  const count = Math.max(
    16,
    params.segments ?? Math.ceil((sweep / TWO_PI) * 72),
  );
  const outer: { x: number; y: number }[] = [];
  const inner: { x: number; y: number }[] = [];

  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const angle = -sweep * (1 - t);
    const width = cometWidth(t, params.minWidth, params.maxWidth, power);
    outer.push(pointOnRing(cx, cy, radius + width / 2, angle));
    inner.push(pointOnRing(cx, cy, Math.max(0.2, radius - width / 2), angle));
  }

  const headWidth = cometWidth(1, params.minWidth, params.maxWidth, power);
  const tailWidth = cometWidth(0, params.minWidth, params.maxWidth, power);
  const headInner = inner[inner.length - 1];
  const tailOuter = outer[0];

  let d = `M ${tailOuter.x} ${tailOuter.y}`;
  for (let i = 1; i < outer.length; i += 1) {
    d += ` L ${outer[i].x} ${outer[i].y}`;
  }
  d += ` A ${headWidth / 2} ${headWidth / 2} 0 1 1 ${headInner.x} ${headInner.y}`;
  for (let i = inner.length - 2; i >= 0; i -= 1) {
    d += ` L ${inner[i].x} ${inner[i].y}`;
  }
  d += ` A ${Math.max(0.2, tailWidth / 2)} ${Math.max(0.2, tailWidth / 2)} 0 0 0 ${tailOuter.x} ${tailOuter.y}`;
  d += " Z";
  return d;
}

export function stepToward(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number,
): number {
  if (tauMs <= 0) {
    return target;
  }
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * alpha;
}
