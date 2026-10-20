import { useEffect, useRef, type RefObject } from "react";
import { GALLERY_VIEWPORT_SCROLL_REVEAL } from "../../features/gallery/lib/viewport/galleryScrollJump";
import { pointerOverTopNavDock } from "../../features/gallery/lib/chrome/topNavDock";
import { useTranslation } from "react-i18next";
import {
  inScrollbarRevealLane,
  scrollbarMetrics,
  scrollTopFromDrag,
  trackLimits,
  type RectLike,
} from "./scrollbarGeometry";
import styles from "./GalleryScrollbar.module.scss";

const TRACK_MS = 280;
/** Показать ползунок при прокрутке (колёсико, прыжок) и скрыть после паузы. */
const SCROLL_REVEAL_HIDE_MS = 900;

type GalleryScrollbarProps = {
  viewportRef: RefObject<HTMLDivElement | null>;
  contentHeight: number;
  topOpen: boolean;
  bottomOpen: boolean;
};

type Cache = {
  scrollHeight: number;
  clientHeight: number;
  trackTop: number;
  trackBottom: number;
  top: number;
  bottom: number;
  right: number;
};

export function GalleryScrollbar({ viewportRef, contentHeight, topOpen, bottomOpen }: GalleryScrollbarProps) {
  const { t } = useTranslation();
  const thumbRef = useRef<HTMLDivElement>(null);
  const topOpenRef = useRef(topOpen);
  const bottomOpenRef = useRef(bottomOpen);
  topOpenRef.current = topOpen;
  bottomOpenRef.current = bottomOpen;
  const cacheRef = useRef<Cache>({
    scrollHeight: 0,
    clientHeight: 0,
    trackTop: 0,
    trackBottom: 0,
    top: 0,
    bottom: 0,
    right: 0,
  });
  const trackRef = useRef({ top: 0, bottom: 0 });
  const placedRef = useRef(false);
  const dragRef = useRef<{ y: number; scroll: number } | null>(null);
  const nearRef = useRef(false);
  const pointerRef = useRef(0);
  const trackTimer = useRef(0);
  const scrollRevealTimer = useRef(0);
  const lastScrollTopRef = useRef(0);
  const frameRef = useRef(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const thumb = thumbRef.current;
    const host = viewport?.parentElement;
    if (!viewport || !thumb || !host) {
      return;
    }

    const place = () => {
      frameRef.current = 0;
      const cache = cacheRef.current;
      const metrics = scrollbarMetrics({
        scrollHeight: cache.scrollHeight,
        clientHeight: cache.clientHeight,
        scrollTop: viewport.scrollTop,
        trackTop: cache.trackTop,
        trackBottom: cache.trackBottom,
      });
      thumb.dataset.overflow = metrics.visible ? "true" : "false";
      thumb.tabIndex = metrics.visible ? 0 : -1;
      thumb.setAttribute("aria-valuemin", "0");
      thumb.setAttribute("aria-valuemax", String(Math.round(metrics.overflow)));
      thumb.setAttribute("aria-valuenow", String(Math.round(Math.min(metrics.overflow, Math.max(0, viewport.scrollTop)))));
      if (!metrics.visible) {
        thumb.dataset.shown = "false";
        return;
      }
      thumb.style.height = `${metrics.thumbHeight}px`;
      thumb.style.transform = `translate3d(0, ${metrics.thumbTop}px, 0)`;
    };

    const schedule = () => {
      if (frameRef.current !== 0) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(place);
    };

    const measure = () => {
      const shell = viewport.closest("main");
      const viewportRect = viewport.getBoundingClientRect();
      const obstacles: { rect: RectLike; edge: "top" | "bottom" }[] = [];
      if (shell) {
        for (const node of shell.querySelectorAll<HTMLElement>("[data-scrollbar-obstacle]")) {
          const edge = node.dataset.scrollbarObstacle === "bottom" ? "bottom" : "top";
          if (edge === "top" && !topOpenRef.current) {
            continue;
          }
          if (edge === "bottom" && !bottomOpenRef.current) {
            continue;
          }
          if (node.closest("[data-viewer]") || node.getClientRects().length === 0) {
            continue;
          }
          obstacles.push({ rect: rectWithoutTransform(node), edge });
        }
      }
      const limits = trackLimits(viewportRect, obstacles);
      const previous = trackRef.current;
      const trackChanged = placedRef.current && (previous.top !== limits.trackTop || previous.bottom !== limits.trackBottom);
      placedRef.current = true;
      if (trackChanged) {
        thumb.dataset.trackAnimate = "true";
        window.clearTimeout(trackTimer.current);
        trackTimer.current = window.setTimeout(() => {
          delete thumb.dataset.trackAnimate;
        }, TRACK_MS);
        if (dragRef.current) {
          dragRef.current.y = pointerRef.current;
          dragRef.current.scroll = viewport.scrollTop;
        }
      }
      trackRef.current = { top: limits.trackTop, bottom: limits.trackBottom };
      cacheRef.current = {
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
        trackTop: limits.trackTop,
        trackBottom: limits.trackBottom,
        top: viewportRect.top,
        bottom: viewportRect.bottom,
        right: viewportRect.right,
      };
      place();
    };

    const hideAfterScrollReveal = () => {
      window.clearTimeout(scrollRevealTimer.current);
      scrollRevealTimer.current = window.setTimeout(() => {
        if (!nearRef.current && !dragRef.current) {
          thumb.dataset.shown = "false";
        }
      }, SCROLL_REVEAL_HIDE_MS);
    };

    const revealForScroll = () => {
      if (dragRef.current || thumb.dataset.overflow !== "true") {
        return;
      }
      thumb.dataset.shown = "true";
      hideAfterScrollReveal();
    };

    const onScroll = () => {
      delete thumb.dataset.trackAnimate;
      const top = viewport.scrollTop;
      const moved = Math.abs(top - lastScrollTopRef.current) >= 1;
      lastScrollTopRef.current = top;
      if (!dragRef.current && moved) {
        revealForScroll();
      }
      schedule();
    };

    const onProgrammaticReveal = () => {
      lastScrollTopRef.current = viewport.scrollTop;
      revealForScroll();
      schedule();
    };

    const onMouseMove = (event: MouseEvent) => {
      if (pointerOverTopNavDock(event.clientX, event.clientY)) {
        if (!dragRef.current) {
          nearRef.current = false;
          thumb.dataset.shown = "false";
        }
        return;
      }
      const near = inScrollbarRevealLane(event.clientX, event.clientY, cacheRef.current);
      const wasNear = nearRef.current;
      nearRef.current = near;
      if (near && !wasNear && thumb.dataset.overflow === "true") {
        thumb.dataset.shown = "true";
        return;
      }
      if (wasNear && !near && !dragRef.current) {
        thumb.dataset.shown = "false";
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || thumb.dataset.overflow !== "true") {
        return;
      }
      event.stopPropagation();
      pointerRef.current = event.clientY;
      dragRef.current = { y: event.clientY, scroll: viewport.scrollTop };
      thumb.dataset.dragging = "true";
      thumb.dataset.shown = "true";
      document.documentElement.dataset.scrollbarDrag = "true";
      thumb.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      pointerRef.current = event.clientY;
      const cache = cacheRef.current;
      const metrics = scrollbarMetrics({
        scrollHeight: cache.scrollHeight,
        clientHeight: cache.clientHeight,
        scrollTop: viewport.scrollTop,
        trackTop: cache.trackTop,
        trackBottom: cache.trackBottom,
      });
      viewport.scrollTop = scrollTopFromDrag(drag.scroll, event.clientY - drag.y, metrics.maxTravel, metrics.overflow);
    };

    const endDrag = (event: PointerEvent) => {
      if (!dragRef.current) {
        return;
      }
      dragRef.current = null;
      delete thumb.dataset.dragging;
      delete document.documentElement.dataset.scrollbarDrag;
      if (thumb.hasPointerCapture(event.pointerId)) {
        thumb.releasePointerCapture(event.pointerId);
      }
      if (!nearRef.current && !thumb.matches(":hover")) {
        thumb.dataset.shown = "false";
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const cache = cacheRef.current;
      const page = Math.max(48, cache.clientHeight * 0.9);
      const step = Math.max(48, cache.clientHeight * 0.1);
      let next = viewport.scrollTop;
      if (event.key === "ArrowDown") {
        next += step;
      } else if (event.key === "ArrowUp") {
        next -= step;
      } else if (event.key === "PageDown") {
        next += page;
      } else if (event.key === "PageUp") {
        next -= page;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = cache.scrollHeight;
      } else {
        return;
      }
      event.preventDefault();
      viewport.scrollTop = Math.min(Math.max(0, cache.scrollHeight - cache.clientHeight), Math.max(0, next));
    };

    lastScrollTopRef.current = viewport.scrollTop;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const shell = viewport.closest("main");
    if (shell) {
      for (const node of shell.querySelectorAll<HTMLElement>("[data-scrollbar-obstacle]")) {
        observer.observe(node);
      }
    }
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener(GALLERY_VIEWPORT_SCROLL_REVEAL, onProgrammaticReveal);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    thumb.addEventListener("pointerdown", onPointerDown);
    thumb.addEventListener("pointermove", onPointerMove);
    thumb.addEventListener("pointerup", endDrag);
    thumb.addEventListener("pointercancel", endDrag);
    thumb.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(trackTimer.current);
      window.clearTimeout(scrollRevealTimer.current);
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener(GALLERY_VIEWPORT_SCROLL_REVEAL, onProgrammaticReveal);
      window.removeEventListener("mousemove", onMouseMove);
      thumb.removeEventListener("pointerdown", onPointerDown);
      thumb.removeEventListener("pointermove", onPointerMove);
      thumb.removeEventListener("pointerup", endDrag);
      thumb.removeEventListener("pointercancel", endDrag);
      thumb.removeEventListener("keydown", onKeyDown);
      delete document.documentElement.dataset.scrollbarDrag;
    };
  }, [viewportRef, contentHeight, topOpen, bottomOpen]);

  return (
    <div
      ref={thumbRef}
      className={styles.thumb}
      data-gallery-scrollbar="true"
      role="scrollbar"
      aria-orientation="vertical"
      aria-label={t("gallery.scrollbarAria")}
    >
      <span className={styles.face} />
    </div>
  );
}

export function rectWithoutTransform(node: HTMLElement): RectLike {
  const rect = node.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  let current: HTMLElement | null = node;
  while (current && current !== document.documentElement) {
    const value = getComputedStyle(current).transform;
    if (value && value !== "none") {
      const matrix = new DOMMatrix(value);
      dx += matrix.m41;
      dy += matrix.m42;
    }
    current = current.parentElement;
  }
  return {
    left: rect.x - dx,
    right: rect.right - dx,
    top: rect.y - dy,
    bottom: rect.bottom - dy,
  };
}
