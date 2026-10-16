import { useEffect, useState } from "react";
import { isModalMotionEnabled, MODAL_MOTION_MS, type ModalMotionPhase } from "./modalMotion";

export function useAnimatedModal(open: boolean): { mounted: boolean; phase: ModalMotionPhase } {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<ModalMotionPhase>(() => {
    if (!open) {
      return "exiting";
    }
    return isModalMotionEnabled() ? "entering" : "open";
  });

  useEffect(() => {
    const motion = isModalMotionEnabled();
    if (open) {
      setMounted(true);
      if (!motion) {
        setPhase("open");
        return;
      }
      setPhase("entering");
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPhase("open"));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }

    setPhase("exiting");
    if (!motion) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), MODAL_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return { mounted, phase };
}
