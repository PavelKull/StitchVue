import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ImageFile, ImageMeta, ThumbInfo } from "../../entities/image/types";
import { displayAspect, rotationQuarters, tilePhotoStyle } from "../../features/gallery/lib/viewer/displayRotation";
import { photoDateLabel } from "../../features/gallery/lib/listing/galleryOrder";
import {
  resolveGalleryPhotoClick,
  shouldSuppressNativeSelection,
  suppressGalleryNativeSelectStart,
} from "../../features/selection/lib/galleryPhotoClick";
import {
  selectionDiag,
  selectionDiagBeginGesture,
  selectionDiagEnabled,
  selectionDiagEndGesture,
  selectionDiagNoteHandler,
  selectionDiagPointer,
  selectionDiagSelectStart,
} from "../../features/selection/lib/selectionDiag";
import { pathKey } from "../../features/selection/lib/selection";
import { useTranslation } from "react-i18next";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import type { StitchVueIconName } from "../../shared/icons/stitchvue-icons";
import {
  decodeWindow,
  ESTIMATED_ASPECT,
  emptySegmentedLayout,
  firstGeometryRange,
  GEOMETRY_FIRST_LAYOUT,
  layoutColumnsPublished,
  layoutMosaicPublished,
  layoutNeedsAspectRefresh,
  layoutSegmented,
  refineSegmentedLayout,
  SEGMENT_SIZE,
  rowAtY,
  rowForIndex,
  rowsCovering,
  type SegmentedLayout,
} from "./layout";
import { GalleryScrollbar } from "./GalleryScrollbar";
import { compensateHeaderScrollTop, FOLDER_HEADER_TOP_PX } from "./folderHeaderScroll";
import {
  cancelPhotoFlip,
  computePhotoFlipMoves,
  createPhotoFlipSession,
  playPhotoFlipMoves,
  readVisiblePhotoRects,
  shouldAbortPhotoFlip,
  type PhotoFlipRequest,
} from "./photoDeleteFlip";
import { isModalMotionEnabled } from "../../shared/ui/modalMotion";
import { resolveBottomScrollPad } from "../../features/gallery/lib/viewport/bottomScrollPad";
import styles from "./StitchVueGrid.module.scss";

export const ZOOM_STEPS = [8, 6, 4, 3, 2, 1.5, 1];
export const FOLDER_HEADER_MORPH_MS = 380;

const GALLERY_LAYOUT_MORPH_MS = 400;

type StitchVueGridProps = {
  files: ImageFile[];
  meta: Map<string, ImageMeta>;
  thumbs: Map<string, ThumbInfo>;
  failed: Map<string, string>;
  rowsPerScreen: number;
  fit: number;
  layoutMode: import("./layout").LayoutMode;
  metaVersion: number;
  paintVersion: number;
  /** Ширина для layoutGallery во время анимации inset (без пересчёта на каждом кадре ResizeObserver). */
  layoutWidthFreeze?: number | null;
  /** Высота viewport для layout во время fullscreen OS-resize (один пересчёт после settle). */
  layoutHeightFreeze?: number | null;
  layoutInsetAnimating?: boolean;
  viewportRef?: RefObject<HTMLDivElement | null>;
  onVisible: (
    start: number,
    end: number,
    tier: number,
    focusStart: number,
    focusEnd: number,
  ) => void;
  /** First-screen header window. Must not wait for a published layout. */
  onGeometryRange?: (start: number, end: number) => void;
  onScrollActivity?: (scrollTop: number) => void;
  /** Ref для программной прокрутки (прыжок): обновляет scrollTop виртуализации без onScroll. */
  galleryViewportScrollSyncRef?: RefObject<((scrollTop: number) => void) | null>;
  onOpen: (index: number) => void;
  onHoverPhoto?: (index: number, inside: boolean) => void;
  onToggleSelect?: (index: number) => void;
  onExtendSelect?: (index: number) => void;
  onClearSelect?: () => void;
  onFavorite?: (index: number) => void;
  onDelete?: (index: number) => void;
  onRestore?: (index: number) => void;
  onTrashMultiSelectBlocked?: () => void;
  selectedKeys?: ReadonlySet<string>;
  selectionMode?: boolean;
  busy?: boolean;
  busyPaths?: ReadonlySet<string>;
  inFavorites?: boolean;
  inTrash?: boolean;
  favoritePaths?: ReadonlySet<string>;
  /** When set, overrides `inFavorites` + `favoritePaths` for star display (optimistic overlay). */
  resolveFavoriteStar?: (pathKey: string) => boolean;
  showDates?: boolean;
  orderStamp?: string;
  /** False while names/stats are still streaming. Mosaic must not commit a short last row. */
  listingComplete?: boolean;
  onZoom: (rowsPerScreen: number) => void;
  restoreScrollTop?: number | null;
  restoreToken?: number;
  /** Смена папки сбрасывает прокрутку в начало и не переносит якорь предыдущей папки. */
  directoryKey?: string | null;
  /** Верхняя панель сейчас на экране. Меняет только дорожку ползунка. */
  scrollbarTopOpen?: boolean;
  /** Нижняя панель сейчас на экране. Меняет только дорожку ползунка. */
  scrollbarBottomOpen?: boolean;
  /**
   * Запас снизу viewport под нижнюю панель (высота дока + edge + зазор).
   * Добавляется к высоте scroll spacer, не к раскладке рядов.
   */
  bottomOverlayReserve?: number;
  /** Плитки подпапок над сеткой; прокручиваются вместе с фото. */
  folderHeader?: ReactNode;
  /** Стабильный ключ состава папок (пути), без идентичности React-узла. */
  folderHeaderKey?: string;
  /** Плавное изменение высоты шапки: только у верхнего края, не при открытии каталога. */
  animateHeaderHeight?: boolean;
  onHeaderMorphEnd?: () => void;
  /** Плавное схлопывание блока папок перед удалением из списка. */
  folderHeaderExiting?: boolean;
  /** First snapshot after a successful single-photo trash move. */
  photoFlip?: PhotoFlipRequest | null;
  onPhotoFlipSettled?: (generation: number) => void;
};

export function StitchVueGrid({
  files,
  meta,
  thumbs,
  failed,
  rowsPerScreen,
  fit,
  layoutMode,
  metaVersion,
  paintVersion,
  layoutWidthFreeze,
  layoutHeightFreeze = null,
  layoutInsetAnimating,
  viewportRef: viewportRefProp,
  onVisible,
  onGeometryRange,
  onScrollActivity,
  galleryViewportScrollSyncRef,
  onOpen,
  onHoverPhoto,
  onToggleSelect,
  onExtendSelect,
  onClearSelect,
  onFavorite,
  onDelete,
  onRestore,
  onTrashMultiSelectBlocked,
  selectedKeys,
  selectionMode = false,
  busy = false,
  busyPaths,
  inFavorites = false,
  inTrash = false,
  favoritePaths,
  resolveFavoriteStar,
  showDates = false,
  orderStamp = "",
  listingComplete = true,
  onZoom,
  restoreScrollTop = null,
  restoreToken = 0,
  directoryKey = null,
  scrollbarTopOpen = false,
  scrollbarBottomOpen = false,
  bottomOverlayReserve = 0,
  folderHeader,
  folderHeaderKey = "",
  animateHeaderHeight = false,
  onHeaderMorphEnd,
  folderHeaderExiting = false,
  photoFlip = null,
  onPhotoFlipSettled,
}: StitchVueGridProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const folderHeaderShellRef = useRef<HTMLDivElement>(null);
  const folderHeaderInnerRef = useRef<HTMLDivElement>(null);
  const [naturalHeaderHeight, setNaturalHeaderHeight] = useState(0);
  const [clipHeaderHeight, setClipHeaderHeight] = useState(0);
  const [layoutHeaderOffset, setLayoutHeaderOffset] = useState(0);
  const lastHeaderHeightForScroll = useRef(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const anchorRef = useRef({ index: 0, fraction: 0 });
  const layoutKey = useRef("");
  const layoutRef = useRef<SegmentedLayout>(emptySegmentedLayout());
  const mosaicInputRef = useRef("");
  const [layout, setLayout] = useState<SegmentedLayout>(emptySegmentedLayout());
  const [builtKey, setBuiltKey] = useState("");
  const onScrollActivityRef = useRef(onScrollActivity);
  onScrollActivityRef.current = onScrollActivity;
  const publishViewportScrollTop = useCallback((top: number) => {
    setScrollTop(top);
    onScrollActivityRef.current?.(top);
  }, []);
  useEffect(() => {
    if (!galleryViewportScrollSyncRef) {
      return;
    }
    galleryViewportScrollSyncRef.current = publishViewportScrollTop;
    return () => {
      galleryViewportScrollSyncRef.current = null;
    };
  }, [galleryViewportScrollSyncRef, publishViewportScrollTop]);
  const layoutMorphTimer = useRef(0);
  const layoutMorphReady = useRef(false);
  const [layoutMorph, setLayoutMorph] = useState(false);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  const onGeometryRangeRef = useRef(onGeometryRange);
  onGeometryRangeRef.current = onGeometryRange;
  const appliedRestore = useRef(0);
  const seenFolder = useRef<string | null | undefined>(undefined);
  const geometryKeyForHeaderRef = useRef("");
  const directoryForHeaderRef = useRef<string | null | undefined>(undefined);
  const pendingOpenBaselineRef = useRef(true);
  const onHeaderMorphEndRef = useRef(onHeaderMorphEnd);
  onHeaderMorphEndRef.current = onHeaderMorphEnd;
  const photoFlipSession = useRef(createPhotoFlipSession());
  const onPhotoFlipSettledRef = useRef(onPhotoFlipSettled);
  onPhotoFlipSettledRef.current = onPhotoFlipSettled;
  const geometryKeyRef = useRef("");
  const layoutHeaderOffsetRef = useRef(0);

  const selectionModeDiagRef = useRef(selectionMode);
  selectionModeDiagRef.current = selectionMode;
  const selectedCountDiagRef = useRef(selectedKeys?.size ?? 0);
  selectedCountDiagRef.current = selectedKeys?.size ?? 0;

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) {
      selectionDiagSelectStart(false);
      return;
    }
    const onSelectStart = (event: Event) => {
      selectionDiagSelectStart(true, true);
      suppressGalleryNativeSelectStart(event);
    };
    node.addEventListener("selectstart", onSelectStart);
    selectionDiagSelectStart(true, false);

    if (!selectionDiagEnabled()) {
      return () => node.removeEventListener("selectstart", onSelectStart);
    }

    const onCapture = (phase: "pointerdown" | "mousedown" | "mouseup" | "click") => (event: Event) => {
      const e = event as PointerEvent | MouseEvent;
      const mods = "ctrlKey" in e && (e.ctrlKey || e.shiftKey || e.metaKey);
      const onPhoto = e.target instanceof Element && e.target.closest("[data-photo-key]") !== null;
      // Log modifier gestures always; plain photo clicks for hit-test; skip idle viewport chrome.
      if (!mods && !onPhoto) {
        return;
      }
      if (!mods && phase === "pointerdown") {
        return;
      }
      selectionDiagPointer(
        phase,
        {
          target: e.target,
          currentTarget: e.currentTarget,
          ctrlKey: "ctrlKey" in e ? e.ctrlKey : false,
          shiftKey: "shiftKey" in e ? e.shiftKey : false,
          metaKey: "metaKey" in e ? e.metaKey : false,
          defaultPrevented: e.defaultPrevented,
          button: "button" in e ? e.button : undefined,
          clientX: "clientX" in e ? e.clientX : undefined,
          clientY: "clientY" in e ? e.clientY : undefined,
        },
        {
          capture: true,
          selectionMode: selectionModeDiagRef.current,
          selectedCount: selectedCountDiagRef.current,
        },
      );
    };
    const pointerdown = onCapture("pointerdown");
    const mousedown = onCapture("mousedown");
    const mouseup = onCapture("mouseup");
    const click = onCapture("click");
    node.addEventListener("pointerdown", pointerdown, true);
    node.addEventListener("mousedown", mousedown, true);
    node.addEventListener("mouseup", mouseup, true);
    node.addEventListener("click", click, true);
    return () => {
      node.removeEventListener("selectstart", onSelectStart);
      node.removeEventListener("pointerdown", pointerdown, true);
      node.removeEventListener("mousedown", mousedown, true);
      node.removeEventListener("mouseup", mouseup, true);
      node.removeEventListener("click", click, true);
    };
  }, []);

  useLayoutEffect(() => {
    const node = folderHeaderInnerRef.current;
    if (!node || !folderHeader) {
      setNaturalHeaderHeight(0);
      return;
    }
    const measure = () => {
      setNaturalHeaderHeight(node.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [folderHeader, folderHeaderKey]);

  useLayoutEffect(() => {
    if (folderHeaderExiting) {
      if (!animateHeaderHeight) {
        setClipHeaderHeight(0);
        return;
      }
      if (naturalHeaderHeight <= 0) {
        setClipHeaderHeight(0);
        return;
      }
      setClipHeaderHeight((prev) => {
        if (prev === 0) {
          return naturalHeaderHeight;
        }
        return 0;
      });
      return;
    }
    setClipHeaderHeight(naturalHeaderHeight);
  }, [animateHeaderHeight, folderHeaderExiting, naturalHeaderHeight]);

  useEffect(() => {
    if (!folderHeaderExiting || !animateHeaderHeight || naturalHeaderHeight <= 0) {
      return;
    }
    if (clipHeaderHeight !== naturalHeaderHeight) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      setClipHeaderHeight(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [folderHeaderExiting, animateHeaderHeight, clipHeaderHeight, naturalHeaderHeight]);

  const syncLayoutHeaderOffset = () => {
    const shell = folderHeaderShellRef.current;
    if (!shell || !folderHeader) {
      setLayoutHeaderOffset(0);
      return;
    }
    setLayoutHeaderOffset(shell.getBoundingClientRect().height);
  };

  useLayoutEffect(() => {
    syncLayoutHeaderOffset();
  }, [folderHeader, folderHeaderKey, clipHeaderHeight, naturalHeaderHeight, folderHeaderExiting]);

  useEffect(() => {
    if (!folderHeader || !animateHeaderHeight) {
      return;
    }
    let active = true;
    let frame = 0;
    const loop = () => {
      if (!active) {
        return;
      }
      syncLayoutHeaderOffset();
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    const stop = window.setTimeout(() => {
      active = false;
      window.cancelAnimationFrame(frame);
      syncLayoutHeaderOffset();
      onHeaderMorphEndRef.current?.();
    }, FOLDER_HEADER_MORPH_MS + 48);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(stop);
    };
  }, [folderHeader, animateHeaderHeight, folderHeaderExiting, naturalHeaderHeight, clipHeaderHeight]);

  const photoScrollTop = Math.max(0, scrollTop - layoutHeaderOffset);

  useEffect(() => {
    if (!layoutMorphReady.current) {
      layoutMorphReady.current = true;
      return;
    }
    window.clearTimeout(layoutMorphTimer.current);
    setLayoutMorph(true);
    layoutMorphTimer.current = window.setTimeout(() => {
      setLayoutMorph(false);
      layoutMorphTimer.current = 0;
    }, GALLERY_LAYOUT_MORPH_MS);
    return () => window.clearTimeout(layoutMorphTimer.current);
  }, [rowsPerScreen, layoutMode]);

  const layoutHeightFreezeRef = useRef(layoutHeightFreeze);
  layoutHeightFreezeRef.current = layoutHeightFreeze;
  const layoutWidthFreezeRef = useRef(layoutWidthFreeze);
  layoutWidthFreezeRef.current = layoutWidthFreeze;
  const pendingViewportSize = useRef<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) {
      return;
    }
    const update = () => {
      const nextWidth = node.clientWidth;
      const nextHeight = node.clientHeight;
      if (layoutHeightFreezeRef.current != null) {
        pendingViewportSize.current = { width: nextWidth, height: nextHeight };
        return;
      }
      if (layoutWidthFreezeRef.current != null) {
        setHeight(nextHeight);
        return;
      }
      setWidth(nextWidth);
      setHeight(nextHeight);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [files.length]);

  useEffect(() => {
    if (layoutHeightFreeze != null) {
      return;
    }
    const node = viewportRef.current;
    if (!node) {
      const pending = pendingViewportSize.current;
      if (pending) {
        setWidth(pending.width);
        setHeight(pending.height);
        pendingViewportSize.current = null;
      }
      return;
    }
    if (layoutWidthFreeze != null) {
      setHeight(node.clientHeight);
      return;
    }
    setWidth(node.clientWidth);
    setHeight(node.clientHeight);
    pendingViewportSize.current = null;
  }, [layoutHeightFreeze, layoutWidthFreeze]);

  const layoutWidth =
    layoutWidthFreeze != null && layoutWidthFreeze > 0 ? layoutWidthFreeze : width;
  const layoutHeight =
    layoutHeightFreeze != null && layoutHeightFreeze > 0
      ? layoutHeightFreeze
      : height;
  const layoutVersionKey = `${directoryKey ?? ""}:${orderStamp}:${layoutWidth}:${layoutHeight}:${rowsPerScreen}:${fit}:${layoutMode}`;
  const geometryKey = GEOMETRY_FIRST_LAYOUT
    ? layoutMode === "grid"
      ? `${layoutVersionKey}:${files.length}`
      : layoutVersionKey
    : `${layoutVersionKey}:${files.length}:${metaVersion}`;
  geometryKeyRef.current = geometryKey;
  layoutHeaderOffsetRef.current = layoutHeaderOffset;

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) {
      return;
    }
    const next = layoutHeaderOffset;
    const previous = lastHeaderHeightForScroll.current;
    const directoryChanged = directoryForHeaderRef.current !== directoryKey;
    if (directoryChanged) {
      directoryForHeaderRef.current = directoryKey;
      geometryKeyForHeaderRef.current = geometryKey;
      lastHeaderHeightForScroll.current = next;
      pendingOpenBaselineRef.current = true;
      return;
    }
    const geometryChanged = geometryKeyForHeaderRef.current !== geometryKey;
    geometryKeyForHeaderRef.current = geometryKey;
    if (geometryChanged) {
      lastHeaderHeightForScroll.current = next;
      pendingOpenBaselineRef.current = false;
      return;
    }
    if (pendingOpenBaselineRef.current) {
      lastHeaderHeightForScroll.current = next;
      if (node.scrollTop > FOLDER_HEADER_TOP_PX) {
        pendingOpenBaselineRef.current = false;
      } else {
        if (node.scrollTop !== 0) {
          node.scrollTop = 0;
          setScrollTop(0);
        }
        if (!folderHeader || next > 0 || previous === next) {
          pendingOpenBaselineRef.current = false;
        }
        return;
      }
    }
    if (previous === next) {
      return;
    }
    if (animateHeaderHeight) {
      lastHeaderHeightForScroll.current = next;
      if (node.scrollTop <= FOLDER_HEADER_TOP_PX) {
        node.scrollTop = 0;
        setScrollTop(0);
      }
      return;
    }
    const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
    const top = compensateHeaderScrollTop(node.scrollTop, previous, next, maxScroll);
    lastHeaderHeightForScroll.current = next;
    if (node.scrollTop !== top) {
      node.scrollTop = top;
    }
    setScrollTop(node.scrollTop);
  }, [layoutHeaderOffset, animateHeaderHeight, directoryKey, geometryKey, folderHeader]);

  const sized = layoutWidth > 0 && layoutHeight > 0 && files.length > 0;
  const geometryRange = sized
    ? firstGeometryRange(layoutWidth, layoutHeight, rowsPerScreen, files.length)
    : { start: 0, end: 0 };
  const geometryPublished =
    GEOMETRY_FIRST_LAYOUT && (layoutMode === "mosaic" || layoutMode === "columns");

  const keyChanged = builtKey !== geometryKey;
  const aspectRefresh =
    !GEOMETRY_FIRST_LAYOUT &&
    sized &&
    !keyChanged &&
    layoutNeedsAspectRefresh(
      layout.usedAspects,
      files.slice(0, Math.min(files.length, SEGMENT_SIZE)).map((file) => aspectOf(file, meta)),
      files.length,
    );

  let paintedLayout = layout;
  if (geometryPublished && sized) {
    const mosaicInputKey = `${layoutMode}:${metaVersion}:${files.length}:${listingComplete ? 1 : 0}`;
    const skipMosaic = !keyChanged && mosaicInputRef.current === mosaicInputKey;
    if (skipMosaic) {
      paintedLayout = layout;
      layoutRef.current = layout;
    } else {
      const slots = files.map((file) => trustedAspect(file, meta, failed));
      const next =
        layoutMode === "columns"
          ? layoutColumnsPublished(
              slots,
              layoutWidth,
              layoutHeight,
              rowsPerScreen,
              keyChanged ? null : layoutRef.current,
              listingComplete,
              fit,
            )
          : layoutMosaicPublished(
              slots,
              layoutWidth,
              layoutHeight,
              rowsPerScreen,
              fit,
              keyChanged ? null : layoutRef.current,
              listingComplete,
            );
      mosaicInputRef.current = mosaicInputKey;
      layoutRef.current = next;
      paintedLayout = next;
      if (next !== layout) {
        setBuiltKey(geometryKey);
        setLayout(next);
      }
    }
  } else if (!keyChanged && !aspectRefresh) {
    layoutRef.current = layout;
  } else if (sized) {
    paintedLayout = layoutSegmented(
      files.map((file) => aspectOf(file, meta)),
      layoutWidth,
      layoutHeight,
      rowsPerScreen,
      fit,
      layoutMode,
    );
    layoutRef.current = paintedLayout;
    setBuiltKey(geometryKey);
    setLayout(paintedLayout);
  }

  useLayoutEffect(() => {
    if (!sized) {
      return;
    }
    onGeometryRangeRef.current?.(geometryRange.start, geometryRange.end);
  }, [sized, geometryRange.start, geometryRange.end]);

  useEffect(() => {
    const node = viewportRef.current;
    const current = layoutRef.current;
    const folderChanged = seenFolder.current !== directoryKey;
    if (!node || current.segments.length === 0) {
      if (folderChanged && node) {
        seenFolder.current = directoryKey;
        anchorRef.current = { index: 0, fraction: 0 };
        if (node.scrollTop !== 0) {
          node.scrollTop = 0;
          setScrollTop(0);
        }
      }
      return;
    }
    if (!folderChanged && layoutKey.current === geometryKey) {
      return;
    }
    const previous = layoutKey.current;
    layoutKey.current = geometryKey;
    if (folderChanged) {
      seenFolder.current = directoryKey;
    }
    if (previous === "" || folderChanged) {
      anchorRef.current = { index: 0, fraction: 0 };
      if (node.scrollTop !== 0) {
        node.scrollTop = 0;
        setScrollTop(0);
      }
      return;
    }
    const anchor = anchorRef.current;
    const row = rowForIndex(current, anchor.index);
    if (!row) {
      return;
    }
    node.scrollTop = Math.max(
      0,
      layoutHeaderOffset + row.top + anchor.fraction * row.height - node.clientHeight / 2,
    );
    setScrollTop(node.scrollTop);
  }, [geometryKey, directoryKey]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const request = photoFlip;
    if (!request || !viewport) {
      return;
    }
    const settle = () => onPhotoFlipSettledRef.current?.(request.generation);
    if (
      photoFlipSession.current.generation === request.generation &&
      photoFlipSession.current.animations.length > 0
    ) {
      return;
    }
    if (directoryKey !== request.directoryKey) {
      cancelPhotoFlip(photoFlipSession.current);
      settle();
      return;
    }
    const userScrollDelta = viewport.scrollTop - request.scrollTop;
    const current = layoutRef.current;
    const liveGeometryKey = geometryKeyRef.current;
    if (layoutKey.current !== liveGeometryKey && current.segments.length > 0) {
      const folderChanged = seenFolder.current !== directoryKey;
      if (!folderChanged && layoutKey.current !== "") {
        const anchor = anchorRef.current;
        const row = rowForIndex(current, anchor.index);
        if (row) {
          viewport.scrollTop = Math.max(
            0,
            layoutHeaderOffsetRef.current + row.top + anchor.fraction * row.height - viewport.clientHeight / 2,
          );
        }
      }
      layoutKey.current = liveGeometryKey;
    }
    const last = readVisiblePhotoRects(viewport);
    const moves = computePhotoFlipMoves(request.first, last);
    const reason = shouldAbortPhotoFlip({
      motionEnabled: isModalMotionEnabled(),
      generation: request.generation,
      sessionGeneration: photoFlipSession.current.generation,
      directoryUnchanged: true,
      layoutModeUnchanged: layoutMode === request.layoutMode,
      zoomUnchanged: rowsPerScreen === request.rowsPerScreen,
      scrollDelta: userScrollDelta,
      moveCount: moves.length,
    });
    if (reason) {
      cancelPhotoFlip(photoFlipSession.current);
      viewport.removeAttribute("data-photo-flip");
      settle();
      return;
    }
    playPhotoFlipMoves(viewport, moves, photoFlipSession.current, request.generation, settle);
    return () => {
      if (photoFlipSession.current.generation === request.generation) {
        cancelPhotoFlip(photoFlipSession.current);
        viewport.removeAttribute("data-photo-flip");
      }
    };
  }, [photoFlip, directoryKey, layoutMode, rowsPerScreen]);

  useEffect(() => {
    return () => {
      cancelPhotoFlip(photoFlipSession.current);
    };
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || restoreToken === 0 || restoreScrollTop == null || layout.segments.length === 0) {
      return;
    }
    if (appliedRestore.current === restoreToken) {
      return;
    }
    appliedRestore.current = restoreToken;
    node.scrollTop = restoreScrollTop;
    setScrollTop(restoreScrollTop);
  }, [restoreToken, restoreScrollTop, layout.height, files.length]);

  useEffect(() => {
    if (GEOMETRY_FIRST_LAYOUT && (layoutMode === "mosaic" || layoutMode === "columns")) {
      return;
    }
    const current = layoutRef.current;
    if (
      current.segments.length === 0 ||
      layoutHeight === 0 ||
      layoutWidth === 0 ||
      files.length === 0
    ) {
      return;
    }
    const aspects = files.map((file) => aspectOf(file, meta));
    const range = decodeWindow(
      rowsCovering(current, photoScrollTop, photoScrollTop + layoutHeight),
      photoScrollTop,
      layoutHeight,
    );
    const refined = refineSegmentedLayout(
      current,
      aspects,
      range.start,
      range.end,
      layoutWidth,
      layoutHeight,
      rowsPerScreen,
      fit,
      layoutMode,
    );
    if (!refined) {
      return;
    }
    layoutRef.current = refined.layout;
    const node = viewportRef.current;
    if (node && refined.scrollDelta !== 0) {
      node.scrollTop = Math.max(0, node.scrollTop + refined.scrollDelta);
      setScrollTop(node.scrollTop);
    }
    setLayout(refined.layout);
  }, [
    metaVersion,
    photoScrollTop,
    geometryKey,
    files,
    meta,
    layoutWidth,
    layoutHeight,
    rowsPerScreen,
    fit,
    layoutMode,
  ]);

  useEffect(() => {
    if (layout.segments.length === 0 || layoutHeight === 0) {
      return;
    }
    const windowRows = rowsCovering(
      layout,
      photoScrollTop,
      photoScrollTop + layoutHeight,
    );
    const range = decodeWindow(windowRows, photoScrollTop, layoutHeight);
    const row = windowRows[0];
    const sample = row?.tiles[0];
    const longEdge = sample && row ? Math.max(sample.width, row.height) : 256;
    const tier = chooseTier(longEdge * window.devicePixelRatio);
    onVisibleRef.current(range.start, range.end, tier, range.focusStart, range.focusEnd);
  }, [photoScrollTop, width, layoutHeight, rowsPerScreen, fit, files, layout]);

  const visibleRows =
    paintedLayout.segments.length === 0
      ? []
      : rowsCovering(
          paintedLayout,
          Math.max(0, photoScrollTop - layoutHeight),
          photoScrollTop + layoutHeight * 2,
        );

  const photoContentHeight = paintedLayout.height + layoutHeaderOffset;
  const bottomScrollPad = resolveBottomScrollPad(
    bottomOverlayReserve,
    photoContentHeight,
    layoutHeight,
  );
  const scrollContentHeight = photoContentHeight + bottomScrollPad;

  const setViewportRef = (node: HTMLDivElement | null) => {
    viewportRef.current = node;
    if (viewportRefProp) {
      viewportRefProp.current = node;
    }
  };

  return (
    <div className={styles.frame}>
    <div
      ref={setViewportRef}
      className={styles.viewport}
      data-gallery-viewport="true"
      data-layout={layoutMode}
      data-layout-smooth={layoutInsetAnimating || layoutMorph ? "true" : undefined}
      data-selection-mode={selectionMode ? "true" : undefined}
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        const target = event.target;
        if (
          !(target instanceof Element) ||
          target.closest(`.${styles.photo}`) ||
          target.closest(`.${styles.folderHeader}`) ||
          target.closest("[data-gallery-scrollbar]")
        ) {
          return;
        }
        onClearSelect?.();
      }}
      onScroll={(event) => {
        const node = event.currentTarget;
        const center = node.scrollTop + node.clientHeight / 2 - layoutHeaderOffset;
        const row = rowAtY(paintedLayout, center);
        if (row && row.tiles[0]) {
          anchorRef.current = {
            index: row.tiles[0].index,
            fraction: row.height === 0 ? 0 : (center - row.top) / row.height,
          };
        }
        setScrollTop(node.scrollTop);
        onScrollActivityRef.current?.(node.scrollTop);
      }}
      onWheel={(event) => {
        if (!event.ctrlKey) {
          return;
        }
        event.preventDefault();
        const current = ZOOM_STEPS.indexOf(rowsPerScreen);
        const index = current === -1 ? ZOOM_STEPS.indexOf(4) : current;
        const next = event.deltaY > 0 ? Math.min(ZOOM_STEPS.length - 1, index + 1) : Math.max(0, index - 1);
        onZoom(ZOOM_STEPS[next]);
      }}
    >
      {folderHeader ? (
        <div
          ref={folderHeaderShellRef}
          className={styles.folderHeader}
          data-morph={animateHeaderHeight ? "true" : undefined}
          style={{ maxHeight: clipHeaderHeight }}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "max-height") {
              return;
            }
            syncLayoutHeaderOffset();
            onHeaderMorphEndRef.current?.();
          }}
        >
          <div ref={folderHeaderInnerRef} className={styles.folderHeaderInner}>
            {folderHeader}
          </div>
        </div>
      ) : null}
      <div
        className={styles.spacer}
        style={{ height: paintedLayout.height + bottomScrollPad }}
        data-paint={paintVersion}
        data-gallery-spacer="true"
      >
        {visibleRows.flatMap((row) => {
          const tiles = row.tiles.map((tile) => {
            const file = files[tile.index];
            if (!file) {
              return null;
            }
            const thumb = thumbs.get(file.path);
            const fail = failed.get(file.path);
            const key = pathKey(file.path);
            const selected = selectedKeys?.has(key) ?? false;
            const fileBusy = busy || (busyPaths?.has(key) ?? false);
            const favoriteOn =
              resolveFavoriteStar?.(key) ??
              (inFavorites || (favoritePaths?.has(key) ?? false));
            const dateLabel = showDates ? photoDateLabel(file.modifiedAt) : null;
            const quarters = rotationQuarters(meta.get(file.path));
            return (
              <div
                key={`${file.path}:${quarters}`}
                className={styles.photo}
                data-photo-key={key}
                data-tile-x={tile.x}
                data-tile-y={row.top}
                data-selected={selected ? "true" : undefined}
                style={{
                  transform: `translate(${tile.x}px, ${row.top}px)`,
                  width: tile.width,
                  height: row.height,
                }}
                onPointerEnter={() => onHoverPhoto?.(tile.index, true)}
                onPointerLeave={() => onHoverPhoto?.(tile.index, false)}
              >
                <button
                  type="button"
                  className={styles.hit}
                  data-sv-layer="hit"
                  aria-label={selectionMode ? t("gallery.selectingFileAria", { name: file.name }) : file.name}
                  onMouseDown={(event) => {
                    if (event.button !== 0 || !shouldSuppressNativeSelection(event)) {
                      return;
                    }
                    const gestureId = selectionDiagBeginGesture("hit-mousedown-modifier");
                    selectionDiagPointer("mousedown", event, {
                      handler: "hit",
                      path: file.path,
                      index: tile.index,
                      selectionMode,
                      selectedCount: selectedKeys?.size ?? 0,
                      gestureId,
                    });
                    // preventDefault stops WebView2 native select; it also cancels click — apply intent here.
                    event.preventDefault();
                    const intent = resolveGalleryPhotoClick({
                      shiftKey: event.shiftKey,
                      ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey,
                      selectionMode,
                      inTrash,
                    });
                    selectionDiag("hit-mousedown-intent", {
                      intent,
                      defaultPrevented: event.defaultPrevented,
                      gestureId,
                      path: file.path,
                    });
                    if (intent === "trash-blocked") {
                      onTrashMultiSelectBlocked?.();
                      selectionDiagEndGesture({ intent, called: false });
                      return;
                    }
                    if (intent === "extend") {
                      selectionDiagNoteHandler("onExtendSelect", {
                        gestureId,
                        path: file.path,
                        index: tile.index,
                        selectionMode,
                        countBefore: selectedKeys?.size ?? 0,
                      });
                      onExtendSelect?.(tile.index);
                      selectionDiagEndGesture({ intent, called: "onExtendSelect" });
                      return;
                    }
                    if (intent === "toggle") {
                      selectionDiagNoteHandler("onToggleSelect", {
                        gestureId,
                        path: file.path,
                        index: tile.index,
                        selectionMode,
                        countBefore: selectedKeys?.size ?? 0,
                      });
                      onToggleSelect?.(tile.index);
                      selectionDiagEndGesture({ intent, called: "onToggleSelect" });
                    }
                  }}
                  onClick={(event) => {
                    // Modifier gestures are handled on mousedown (click is cancelled after preventDefault).
                    if (shouldSuppressNativeSelection(event)) {
                      selectionDiagPointer("click", event, {
                        handler: "hit",
                        skipped: "modifier-handled-on-mousedown",
                        path: file.path,
                        selectionMode,
                      });
                      return;
                    }
                    const intent = resolveGalleryPhotoClick({
                      shiftKey: event.shiftKey,
                      ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey,
                      selectionMode,
                      inTrash,
                    });
                    selectionDiagPointer("click", event, {
                      handler: "hit",
                      intent,
                      path: file.path,
                      index: tile.index,
                      selectionMode,
                      selectedCount: selectedKeys?.size ?? 0,
                    });
                    if (intent === "trash-blocked") {
                      onTrashMultiSelectBlocked?.();
                      return;
                    }
                    if (intent === "extend") {
                      const gestureId = selectionDiagBeginGesture("hit-click-extend");
                      selectionDiagNoteHandler("onExtendSelect", {
                        gestureId,
                        path: file.path,
                        index: tile.index,
                        selectionMode,
                        countBefore: selectedKeys?.size ?? 0,
                      });
                      onExtendSelect?.(tile.index);
                      selectionDiagEndGesture({ intent, called: "onExtendSelect" });
                      return;
                    }
                    if (intent === "toggle") {
                      const gestureId = selectionDiagBeginGesture("hit-click-toggle");
                      selectionDiagNoteHandler("onToggleSelect", {
                        gestureId,
                        path: file.path,
                        index: tile.index,
                        selectionMode,
                        countBefore: selectedKeys?.size ?? 0,
                      });
                      onToggleSelect?.(tile.index);
                      selectionDiagEndGesture({ intent, called: "onToggleSelect" });
                      return;
                    }
                    onOpen(tile.index);
                  }}
                />
                {thumb ? (
                  <img
                    src={convertFileSrc(thumb.thumbnailPath)}
                    alt=""
                    draggable={false}
                    style={tilePhotoStyle(tile.width, row.height, quarters)}
                  />
                ) : (
                  <span className={styles.placeholder}>
                    <StitchVueIcon
                      name={placeholderIconName(file.name)}
                      className={styles.placeholderIcon}
                    />
                    <span className={styles.placeholderLabel}>
                      {fail
                        ? fail === "unsupported"
                          ? t("gallery.tileUnsupported")
                          : t("gallery.tileFailed")
                        : formatLabel(file.name, t("gallery.tileFallbackFormat"))}
                    </span>
                  </span>
                )}
                {!inTrash ? (
                  <button
                    type="button"
                    className={styles.mark}
                    data-sv-layer="mark"
                    aria-pressed={selected}
                    aria-label={
                      selected
                        ? t("gallery.deselectFileAria", { name: file.name })
                        : t("gallery.selectFileAria", { name: file.name })
                    }
                    onMouseDown={(event) => {
                      if (event.button !== 0 || !event.shiftKey) {
                        return;
                      }
                      const gestureId = selectionDiagBeginGesture("mark-mousedown-shift");
                      selectionDiagPointer("mousedown", event, {
                        handler: "mark",
                        path: file.path,
                        gestureId,
                        selectionMode,
                      });
                      event.preventDefault();
                      selectionDiagNoteHandler("onExtendSelect", {
                        gestureId,
                        path: file.path,
                        index: tile.index,
                        selectionMode,
                        countBefore: selectedKeys?.size ?? 0,
                      });
                      onExtendSelect?.(tile.index);
                      selectionDiagEndGesture({ called: "onExtendSelect" });
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (event.shiftKey) {
                        selectionDiagPointer("click", event, {
                          handler: "mark",
                          skipped: "shift-handled-on-mousedown",
                          path: file.path,
                        });
                        // Shift range already applied on mousedown.
                        return;
                      }
                      const gestureId = selectionDiagBeginGesture("mark-click");
                      selectionDiagPointer("click", event, {
                        handler: "mark",
                        path: file.path,
                        gestureId,
                        selectionMode,
                        selectedCount: selectedKeys?.size ?? 0,
                      });
                      selectionDiagNoteHandler("onToggleSelect", {
                        gestureId,
                        path: file.path,
                        index: tile.index,
                        selectionMode,
                        countBefore: selectedKeys?.size ?? 0,
                      });
                      onToggleSelect?.(tile.index);
                      selectionDiagEndGesture({ called: "onToggleSelect" });
                    }}
                  >
                    <span className={styles.markCircle}>{selected ? <span className={styles.markCheck} /> : null}</span>
                  </button>
                ) : null}
                {dateLabel ? <span className={styles.photoDate}>{dateLabel}</span> : null}
                <div className={styles.fileActions} data-sv-layer="file-actions">
                  {!inTrash ? (
                    <button
                      type="button"
                      className={styles.fileAction}
                      data-sv-layer="file-action-favorite"
                      aria-label={favoriteOn ? t("gallery.favoriteRemoveAria") : t("gallery.favoriteAddAria")}
                      aria-pressed={favoriteOn}
                      disabled={fileBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectionDiag("file-action-click", {
                          action: "favorite",
                          path: file.path,
                          ctrlKey: event.ctrlKey,
                          shiftKey: event.shiftKey,
                        });
                        onFavorite?.(tile.index);
                      }}
                    >
                      <StitchVueIcon name="favorite" className={styles.fileActionIcon} />
                    </button>
                  ) : null}
                  {inTrash ? (
                    <button
                      type="button"
                      className={styles.fileAction}
                      data-sv-layer="file-action-restore"
                      aria-label={t("gallery.trashRestoreAria")}
                      disabled={fileBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectionDiag("file-action-click", {
                          action: "restore",
                          path: file.path,
                          ctrlKey: event.ctrlKey,
                          shiftKey: event.shiftKey,
                        });
                        onRestore?.(tile.index);
                      }}
                    >
                      <StitchVueIcon name="file-restore" className={styles.fileActionIcon} />
                    </button>
                  ) : !inFavorites ? (
                    <button
                      type="button"
                      className={styles.fileAction}
                      data-sv-layer="file-action-trash"
                      aria-label={t("gallery.trashMoveAria")}
                      disabled={fileBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectionDiag("file-action-click", {
                          action: "trash",
                          path: file.path,
                          ctrlKey: event.ctrlKey,
                          shiftKey: event.shiftKey,
                        });
                        onDelete?.(tile.index);
                      }}
                    >
                      <StitchVueIcon name="trash" className={styles.fileActionIcon} />
                    </button>
                  ) : null}
                  {selectionMode ? (
                    <button
                      type="button"
                      className={styles.fileAction}
                      data-sv-layer="file-action-open"
                      aria-label={t("gallery.openViewerAria")}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectionDiag("file-action-click", {
                          action: "open",
                          path: file.path,
                          ctrlKey: event.ctrlKey,
                          shiftKey: event.shiftKey,
                        });
                        onOpen(tile.index);
                      }}
                    >
                      <StitchVueIcon name="fullscreen-enter" className={styles.fileActionIcon} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          });
          return tiles;
        })}
      </div>
    </div>
      <GalleryScrollbar
        viewportRef={viewportRef}
        contentHeight={scrollContentHeight}
        topOpen={scrollbarTopOpen}
        bottomOpen={scrollbarBottomOpen}
      />
    </div>
  );
}

function aspectOf(file: { path: string }, meta: Map<string, ImageMeta>): number {
  const known = meta.get(file.path);
  if (!known || known.height === 0) {
    return ESTIMATED_ASPECT;
  }
  return displayAspect(known.width, known.height, rotationQuarters(known));
}

function trustedAspect(
  file: { path: string },
  meta: Map<string, ImageMeta>,
  failed: Map<string, string>,
): number | null {
  const known = meta.get(file.path);
  if (known && known.height > 0) {
    return displayAspect(known.width, known.height, rotationQuarters(known));
  }
  if (failed.has(file.path)) {
    return ESTIMATED_ASPECT;
  }
  return null;
}

function chooseTier(longEdge: number): number {
  if (longEdge <= 256) {
    return 256;
  }
  if (longEdge <= 512) {
    return 512;
  }
  return 1024;
}

export function nextZoom(rowsPerScreen: number, direction: -1 | 1): number {
  const current = zoomIndex(rowsPerScreen);
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, current + direction));
  return ZOOM_STEPS[next];
}

export function zoomIndex(rowsPerScreen: number): number {
  const index = ZOOM_STEPS.indexOf(rowsPerScreen);
  return index === -1 ? ZOOM_STEPS.indexOf(4) : index;
}

export function rowsFromZoomIndex(index: number): number {
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index))];
}

const RAW_EXTENSIONS = new Set([
  "dng",
  "cr2",
  "cr3",
  "crw",
  "nef",
  "nrw",
  "arw",
  "sr2",
  "srf",
  "raf",
  "orf",
  "rw2",
  "pef",
  "srw",
  "3fr",
  "ari",
  "dcr",
  "erf",
  "kdc",
  "mef",
  "mos",
  "mrw",
  "iiq",
  "x3f",
]);

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) {
    return "";
  }
  return fileName.slice(dot + 1);
}

function placeholderIconName(fileName: string): StitchVueIconName {
  return RAW_EXTENSIONS.has(fileExtension(fileName).toLowerCase()) ? "file-raw" : "file-image";
}

function formatLabel(fileName: string, tileFallbackFormat: string): string {
  const extension = fileExtension(fileName);
  return extension ? extension.toUpperCase() : tileFallbackFormat;
}
