import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

/** Hit area along the right / bottom edge of the tree scrollport (matches scrollbar width). */
export const FOLDER_TREE_SCROLLBAR_EDGE_PX = 22;

function applyEdgeState(
  el: HTMLElement,
  vEdge: boolean,
  hEdge: boolean,
  dragging: boolean,
) {
  if (vEdge) {
    el.dataset.scrollbarVEdge = "true";
  } else {
    delete el.dataset.scrollbarVEdge;
  }
  if (hEdge) {
    el.dataset.scrollbarHEdge = "true";
  } else {
    delete el.dataset.scrollbarHEdge;
  }
  if (dragging) {
    el.dataset.scrollbarDrag = "true";
  } else {
    delete el.dataset.scrollbarDrag;
  }
}

/**
 * Edge highlight for native folder-tree scrollbars. Updates data-* on the tree node via ref
 * (no React state on mousemove).
 */
export function useFolderTreeScrollbarReveal(
  treeRef: RefObject<HTMLDivElement | null>,
  edgePx = FOLDER_TREE_SCROLLBAR_EDGE_PX,
) {
  const vEdgeRef = useRef(false);
  const hEdgeRef = useRef(false);
  const draggingRef = useRef(false);

  const sync = useCallback(() => {
    const el = treeRef.current;
    if (!el) {
      return;
    }
    applyEdgeState(el, vEdgeRef.current, hEdgeRef.current, draggingRef.current);
  }, [treeRef]);

  const readEdges = useCallback(
    (clientX: number, clientY: number) => {
      const el = treeRef.current;
      if (!el) {
        return { v: false, h: false };
      }
      const rect = el.getBoundingClientRect();
      return {
        v: clientX >= rect.right - edgePx,
        h: clientY >= rect.bottom - edgePx,
      };
    },
    [edgePx, treeRef],
  );

  const setEdgesFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const { v, h } = readEdges(clientX, clientY);
      if (v === vEdgeRef.current && h === hEdgeRef.current) {
        return;
      }
      vEdgeRef.current = v;
      hEdgeRef.current = h;
      sync();
    },
    [readEdges, sync],
  );

  const onMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (draggingRef.current) {
        return;
      }
      setEdgesFromPointer(event.clientX, event.clientY);
    },
    [setEdgesFromPointer],
  );

  const onMouseLeave = useCallback(() => {
    if (draggingRef.current) {
      return;
    }
    vEdgeRef.current = false;
    hEdgeRef.current = false;
    sync();
  }, [sync]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const el = treeRef.current;
      if (!el) {
        return;
      }
      const { v, h } = readEdges(event.clientX, event.clientY);
      if (!v && !h) {
        return;
      }
      // Lock the axis that started the drag so the other thumb stays at rest.
      draggingRef.current = true;
      vEdgeRef.current = v;
      hEdgeRef.current = h;
      sync();

      let lastX = event.clientX;
      let lastY = event.clientY;
      const onDocMove = (move: PointerEvent) => {
        lastX = move.clientX;
        lastY = move.clientY;
      };
      const end = () => {
        draggingRef.current = false;
        document.removeEventListener("pointermove", onDocMove);
        document.removeEventListener("pointerup", end);
        document.removeEventListener("pointercancel", end);
        const edges = readEdges(lastX, lastY);
        vEdgeRef.current = edges.v;
        hEdgeRef.current = edges.h;
        sync();
      };
      document.addEventListener("pointermove", onDocMove);
      document.addEventListener("pointerup", end);
      document.addEventListener("pointercancel", end);
    },
    [readEdges, sync, treeRef],
  );

  useEffect(() => {
    const el = treeRef.current;
    return () => {
      if (!el) {
        return;
      }
      delete el.dataset.scrollbarVEdge;
      delete el.dataset.scrollbarHEdge;
      delete el.dataset.scrollbarDrag;
    };
  }, [treeRef]);

  return { onMouseMove, onMouseLeave, onPointerDown };
}
