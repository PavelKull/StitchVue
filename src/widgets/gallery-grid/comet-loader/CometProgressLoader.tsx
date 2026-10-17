import { useEffect, useId, useRef, type RefObject } from "react";
import {
  cometFinishMode,
  cometProgressRatio,
  type FolderThumbLoaderSnapshot,
} from "../../../features/gallery/lib/thumbnails/folderThumbLoaderProgress.ts";
import { isModalMotionEnabled } from "../../../shared/ui/modalMotion.ts";
import {
  COMET_HEAD_R,
  COMET_MAX_WIDTH,
  COMET_MIN_WIDTH,
  COMET_VIEW,
  TWO_PI,
  buildCometTailPath,
  cometHeadPoint,
  stepToward,
  sweepFromRatio,
} from "./cometTailPath.ts";
import styles from "../GalleryScrollJumpButton.module.scss";

const TAU_SWEEP_MS = 220;
const CLOSE_MS = 420;
const FADE_MS = 280;

type Visual = {
  sweep: number;
  minWidth: number;
  maxWidth: number;
  opacity: number;
  headOpacity: number;
  glow: number;
};

type CometProgressLoaderProps = {
  loading: boolean;
  sessionKey: string;
  progressRef: RefObject<FolderThumbLoaderSnapshot>;
  onHoldChange: (hold: boolean) => void;
};

function readMotionEnabled(): boolean {
  return isModalMotionEnabled();
}

function initialVisual(loading: boolean, snapshot: FolderThumbLoaderSnapshot): Visual {
  const ratio = cometProgressRatio(snapshot);
  return {
    sweep: sweepFromRatio(ratio),
    minWidth: COMET_MIN_WIDTH,
    maxWidth: COMET_MAX_WIDTH,
    opacity: loading ? 1 : 0,
    headOpacity: 1,
    glow: 1,
  };
}

export function CometProgressLoader({
  loading,
  sessionKey,
  progressRef,
  onHoldChange,
}: CometProgressLoaderProps) {
  const reactId = useId().replace(/:/g, "");
  const glowId = `comet-glow-${reactId}`;
  const groupRef = useRef<SVGGElement>(null);
  const tailRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const visualRef = useRef<Visual | null>(null);
  const phaseRef = useRef<"run" | "close" | "fade" | "idle">(
    loading ? "run" : "idle",
  );
  const phaseStartedRef = useRef(0);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const onHoldChangeRef = useRef(onHoldChange);
  onHoldChangeRef.current = onHoldChange;

  useEffect(() => {
    const snapshot = progressRef.current;
    const active = loadingRef.current;
    visualRef.current = initialVisual(active, snapshot);
    phaseRef.current = active ? "run" : "idle";
    phaseStartedRef.current = performance.now();
    onHoldChangeRef.current(active);
  }, [sessionKey, progressRef]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const motion = readMotionEnabled();

    const paint = (visual: Visual) => {
      const path = buildCometTailPath({
        sweepRad: visual.sweep,
        minWidth: visual.minWidth,
        maxWidth: visual.maxWidth,
      });
      tailRef.current?.setAttribute("d", path);
      glowRef.current?.setAttribute("d", path);
      const head = cometHeadPoint();
      headRef.current?.setAttribute("cx", String(head.x));
      headRef.current?.setAttribute("cy", String(head.y));
      headRef.current?.setAttribute("opacity", String(visual.headOpacity));
      if (groupRef.current) {
        groupRef.current.style.opacity = String(visual.opacity);
        groupRef.current.style.setProperty("--comet-glow", String(visual.glow));
      }
    };

    const applyFinishPhase = (now: number) => {
      const snapshot = progressRef.current;
      const mode = cometFinishMode(snapshot);
      if (mode === "abort" || !motion) {
        phaseRef.current = "idle";
        if (visualRef.current) {
          visualRef.current.opacity = 0;
        }
        onHoldChangeRef.current(false);
        return;
      }
      phaseRef.current = mode === "close" ? "close" : "fade";
      phaseStartedRef.current = now;
      onHoldChangeRef.current(true);
    };

    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const snapshot = progressRef.current;
      let visual = visualRef.current ?? initialVisual(loadingRef.current, snapshot);

      if (loadingRef.current) {
        if (phaseRef.current !== "run") {
          phaseRef.current = "run";
          visual = initialVisual(true, snapshot);
          onHoldChangeRef.current(true);
        }
        const targetSweep = sweepFromRatio(cometProgressRatio(snapshot));
        visual.sweep = motion
          ? stepToward(visual.sweep, targetSweep, dt, TAU_SWEEP_MS)
          : targetSweep;
        visual.minWidth = COMET_MIN_WIDTH;
        visual.maxWidth = COMET_MAX_WIDTH;
        visual.opacity = 1;
        visual.headOpacity = 1;
        visual.glow = 1;
      } else if (phaseRef.current === "run") {
        applyFinishPhase(now);
      }

      if (phaseRef.current === "close") {
        const t = Math.min(1, (now - phaseStartedRef.current) / CLOSE_MS);
        visual.sweep = stepToward(visual.sweep, TWO_PI, dt, 90);
        visual.minWidth = stepToward(visual.minWidth, COMET_MAX_WIDTH, dt, 90);
        visual.headOpacity = Math.max(0, 1 - t * 3);
        visual.glow = t < 0.45 ? 1 + t * 1.4 : 1 + (1 - t) * 0.8;
        if (t >= 0.55) {
          visual.opacity = stepToward(visual.opacity, 0, dt, 70);
        }
        if (t >= 1 && visual.opacity < 0.03) {
          visual.opacity = 0;
          phaseRef.current = "idle";
          onHoldChangeRef.current(false);
        }
      } else if (phaseRef.current === "fade") {
        const t = Math.min(1, (now - phaseStartedRef.current) / FADE_MS);
        visual.headOpacity = 1 - t;
        visual.opacity = 1 - t;
        visual.glow = 1 - t * 0.4;
        if (t >= 1) {
          visual.opacity = 0;
          phaseRef.current = "idle";
          onHoldChangeRef.current(false);
        }
      }

      visualRef.current = visual;
      paint(visual);

      if (phaseRef.current !== "idle" || loadingRef.current) {
        raf = window.requestAnimationFrame(tick);
      }
    };

    const snapshot = progressRef.current;
    const visual = visualRef.current ?? initialVisual(loading, snapshot);
    visualRef.current = visual;
    paint(visual);

    if (!motion && !loading) {
      phaseRef.current = "idle";
      visual.opacity = 0;
      paint(visual);
      onHoldChangeRef.current(false);
      return;
    }

    if (loading || phaseRef.current !== "idle") {
      raf = window.requestAnimationFrame(tick);
    }

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [loading, sessionKey, progressRef]);

  const head = cometHeadPoint();

  return (
    <svg
      className={styles.comet}
      viewBox={`0 0 ${COMET_VIEW} ${COMET_VIEW}`}
      width={COMET_VIEW}
      height={COMET_VIEW}
      aria-hidden
      focusable="false"
    >
      <defs>
        <filter
          id={glowId}
          x="-40%"
          y="-40%"
          width="180%"
          height="180%"
        >
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <g
        ref={groupRef}
        className={styles.cometGroup}
      >
        <path
          ref={glowRef}
          className={styles.cometGlow}
          fill="currentColor"
          fillRule="evenodd"
          filter={`url(#${glowId})`}
        />
        <path
          ref={tailRef}
          className={styles.cometTail}
          fill="currentColor"
          fillRule="evenodd"
        />
        <circle
          ref={headRef}
          className={styles.cometHead}
          cx={head.x}
          cy={head.y}
          r={COMET_HEAD_R}
        />
      </g>
    </svg>
  );
}
