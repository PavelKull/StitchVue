import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeTooltipInViewport, type TooltipPlacement } from "./tooltipPosition";
import styles from "./Tooltip.module.scss";

const HOVER_DELAY_MS = 2000;
const FOCUS_DELAY_MS = 2000;

let listeners = 0;

export function Tooltip({
  text,
  children,
  placement = "above",
  enabled = true,
  className,
}: {
  text: string;
  children: ReactNode;
  placement?: TooltipPlacement;
  /** When false, hover does not open the tip (anchor stays the same for layout). */
  enabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tipStyle, setTipStyle] = useState<CSSProperties | null>(null);
  const timer = useRef(0);
  const hovered = useRef(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    listeners += 1;
    if (listeners === 1) {
      window.addEventListener("keydown", onKeyDown);
    }
    return () => {
      listeners -= 1;
      window.clearTimeout(timer.current);
      if (listeners === 0) {
        window.removeEventListener("keydown", onKeyDown);
        delete document.documentElement.dataset.tips;
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setTipStyle(null);
      return;
    }
    const anchor = wrapRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) {
      return;
    }

    const update = () => {
      const node = wrapRef.current;
      const label = tipRef.current;
      if (!node || !label) {
        return;
      }
      const coords = placeTooltipInViewport(
        node.getBoundingClientRect(),
        label.offsetWidth,
        label.offsetHeight,
        placement,
      );
      setTipStyle({
        left: coords.left,
        top: coords.top,
        transform: "translateX(-50%)",
      });
      label.dataset.placement = coords.placement;
    };

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, text, placement]);

  function arm(delay: number) {
    if (!enabledRef.current) {
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!enabledRef.current || document.documentElement.dataset.tips === "off") {
        return;
      }
      setOpen(true);
    }, delay);
  }

  function close() {
    hovered.current = false;
    window.clearTimeout(timer.current);
    timer.current = 0;
    setOpen(false);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!enabled) {
      close();
      return;
    }
    if (hovered.current) {
      arm(HOVER_DELAY_MS);
    }
  }, [enabled]);

  return (
    <>
      <span
        ref={wrapRef}
        className={className ? `${styles.wrap} ${className}` : styles.wrap}
        onPointerEnter={() => {
          if (!enabled) {
            return;
          }
          hovered.current = true;
          arm(HOVER_DELAY_MS);
        }}
        onPointerLeave={close}
        onPointerDown={close}
        onFocus={(event) => {
          if (hovered.current) {
            return;
          }
          const target = event.target;
          if (target instanceof HTMLElement && target.matches(":focus-visible")) {
            arm(FOCUS_DELAY_MS);
          }
        }}
        onBlur={close}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              className={styles.tip}
              style={tipStyle ?? { left: 0, top: 0, transform: "translateX(-50%)", visibility: "hidden" }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    document.documentElement.dataset.tips = "off";
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointermove", () => {
    if (document.documentElement.dataset.tips === "off") {
      delete document.documentElement.dataset.tips;
    }
  });
}
