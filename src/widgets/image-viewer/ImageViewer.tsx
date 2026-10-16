import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { ImageFile, ImageMeta, ThumbInfo } from "../../entities/image/types";
import { useAppFullscreen } from "../../features/app-fullscreen/useAppFullscreen";
import { useTranslation } from "react-i18next";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import { ViewerControlBar } from "./ViewerControlBar";
import { aspectFromMeta, computeViewerFrame } from "./viewerFrame";
import { displayAspect, rotationQuarters, viewerPhotoStyle } from "../../features/gallery/displayRotation";
import { viewerBackgroundClick } from "../../features/gallery/viewerNav";
import {
  toolbarPeekDistanceFromBottom,
  toolbarPeekShouldActivate,
  toolbarPeekShouldHide,
  toolbarPeekShouldKeepOnLeave,
} from "../../features/gallery/toolbarPeekGeometry";
import { peekPreloaded, promotePreloaded } from "../../features/gallery/viewerPreload";
import { markFirstFrame, markQualityFrame, markViewerOpened, markWebviewDecode } from "./viewerTiming";
import { VIEWER_ZOOM_STEPS, viewerNeededEdge, viewerZoomFromIndex, viewerZoomIndex } from "./viewerZoom";
import styles from "./ImageViewer.module.scss";

type ViewerOffer = {
  previewPath: string;
  previewEdge: number;
  nativePath: string;
  sharpPath: string;
  sharpEdge: number;
  token: number;
};
type ViewerFrameEvent = {
  path: string;
  framePath: string;
  longEdge: number;
  token: number;
  session?: number;
};

const NATIVE_TIER = 10_000;
const NAV_EDGE_PX = 88;

type ImageViewerProps = {
  file: ImageFile;
  meta: ImageMeta | undefined;
  thumb: ThumbInfo | undefined;
  thumbVersion: number;
  metaVersion: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  onClose: () => void;
  onNavigate: (delta: -1 | 1) => void;
  toolbarExtra?: ReactNode;
  onOpenProperties?: () => void;
  onRotate?: () => void;
  modalOpen?: boolean;
  motionPhase?: "entering" | "open" | "exiting";
  favoriteOn?: boolean;
  favoriteDisabled?: boolean;
  onFavorite?: () => void;
  deleteDisabled?: boolean;
  onDelete?: () => void;
  restoreDisabled?: boolean;
  onRestore?: () => void;
  recycleDisabled?: boolean;
  onRecycleToWindows?: () => void;
};

async function decodeImage(src: string): Promise<{ width: number; height: number } | null> {
  const image = new Image();
  image.src = src;
  await image.decode();
  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return null;
}

export function ImageViewer({
  file,
  meta,
  thumb,
  thumbVersion,
  metaVersion,
  canGoPrev,
  canGoNext,
  onClose,
  onNavigate,
  toolbarExtra,
  onOpenProperties,
  onRotate,
  modalOpen = false,
  motionPhase = "open",
  favoriteOn,
  favoriteDisabled,
  onFavorite,
  deleteDisabled,
  onDelete,
  restoreDisabled,
  onRestore,
  recycleDisabled,
  onRecycleToWindows,
}: ImageViewerProps) {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const displayAspectRef = useRef(aspectFromMeta(meta));
  /** Размеры исходного файла (из метаданных), не размер текущего bitmap/preview. */
  const filePixelsRef = useRef({ width: meta?.width ?? 0, height: meta?.height ?? 0 });
  const [fillScreen, setFillScreen] = useState(true);
  const fillScreenRef = useRef(true);
  fillScreenRef.current = fillScreen;
  const [zoomIndex, setZoomIndex] = useState(() => viewerZoomIndex(1));
  const zoomIndexRef = useRef(zoomIndex);
  zoomIndexRef.current = zoomIndex;
  const [viewSize, setViewSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [frame, setFrame] = useState(() =>
    computeViewerFrame(
      displayAspectRef.current,
      window.innerWidth,
      window.innerHeight,
      true,
      1,
    ),
  );
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [opening, setOpening] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const viewSizeRef = useRef(viewSize);
  viewSizeRef.current = viewSize;
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const [grabbing, setGrabbing] = useState(false);
  const panDrag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [navEdge, setNavEdge] = useState<"left" | "right" | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const {
    enabled: appFullscreen,
    phase: fullscreenPhase,
    bottomInset: fullscreenBottomInset,
    toggle: toggleAppFullscreen,
  } = useAppFullscreen();
  const fullscreenBottomInsetRef = useRef(0);
  fullscreenBottomInsetRef.current = fullscreenBottomInset;
  const layoutAnimating =
    fullscreenPhase === "switching" || fullscreenPhase === "settling";
  const toolbarHideTimer = useRef(0);
  const tierRef = useRef(0);
  const nativeHold = useRef(false);
  const tokenRef = useRef(0);
  const filePathRef = useRef(file.path);
  filePathRef.current = file.path;
  const loadGen = useRef(0);
  const displaySrcRef = useRef<string | null>(null);
  displaySrcRef.current = displaySrc;
  const rotationQuartersRef = useRef(0);

  const syncDisplayAspect = (value: ImageMeta | undefined) => {
    if (!value || value.height <= 0) {
      displayAspectRef.current = aspectFromMeta(value);
      return;
    }
    displayAspectRef.current = displayAspect(value.width, value.height, rotationQuarters(value));
  };

  const syncFrame = () => {
    const aspect = displayAspectRef.current;
    const scale = viewerZoomFromIndex(zoomIndexRef.current);
    setFrame(
      computeViewerFrame(
        aspect,
        viewSize.width,
        viewSize.height,
        fillScreenRef.current,
        scale,
      ),
    );
  };

  useEffect(() => {
    const node = shellRef.current;
    if (!node) {
      return;
    }
    const update = () => {
      const rect = node.getBoundingClientRect();
      setViewSize({ width: rect.width, height: Math.max(1, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    syncFrame();
  }, [viewSize.width, viewSize.height, fillScreen, zoomIndex, meta?.width, meta?.height, meta?.rotationQuarters]);

  useEffect(() => {
    if (meta && meta.height > 0) {
      filePixelsRef.current = { width: meta.width, height: meta.height };
      syncDisplayAspect(meta);
      syncFrame();
    }
  }, [meta, metaVersion, fillScreen, zoomIndex, viewSize.width, viewSize.height]);

  useEffect(() => {
    const next = rotationQuarters(meta);
    if (next === rotationQuartersRef.current) {
      return;
    }
    rotationQuartersRef.current = next;
    setPan({ x: 0, y: 0 });
    setZoomIndex(viewerZoomIndex(1));
    requestAnimationFrame(() => syncFrame());
  }, [meta?.rotationQuarters]);

  useEffect(() => {
    rotationQuartersRef.current = rotationQuarters(meta);
    setZoomIndex(viewerZoomIndex(1));
    setPan({ x: 0, y: 0 });
    loadGen.current += 1;
    tierRef.current = 0;
    nativeHold.current = false;
    tokenRef.current = 0;
    markViewerOpened();
    promotePreloaded(file.path);
    const warm = peekPreloaded(file.path);
    if (warm?.native) {
      nativeHold.current = true;
      tierRef.current = NATIVE_TIER;
      setDisplaySrc(warm.src);
      markFirstFrame();
      markQualityFrame();
      setOpening(false);
      return;
    }
    if (warm) {
      tierRef.current = 1024;
      setDisplaySrc(warm.src);
      markFirstFrame();
      setOpening(true);
      return;
    }
    if (thumb) {
      tierRef.current = thumb.tier;
      setDisplaySrc(convertFileSrc(thumb.thumbnailPath));
      markFirstFrame();
      setOpening(true);
      return;
    }
    setDisplaySrc(null);
    setOpening(true);
  }, [file.path]);

  useEffect(() => {
    if (appFullscreen) {
      setFillScreenMode(true);
    }
    requestAnimationFrame(() => syncFrame());
  }, [appFullscreen]);

  useEffect(() => {
    if (fullscreenPhase !== "settling") {
      return;
    }
    const node = shellRef.current;
    if (node) {
      const rect = node.getBoundingClientRect();
      setViewSize({ width: rect.width, height: Math.max(1, rect.height) });
    }
    requestAnimationFrame(() => syncFrame());
  }, [fullscreenPhase, fullscreenBottomInset]);

  const filePixelsFromMeta = (): { width: number; height: number } => ({
    width: meta?.width ?? 0,
    height: meta?.height ?? 0,
  });

  const applyGeometry = (aspect: number, fileWidth: number, fileHeight: number) => {
    displayAspectRef.current = aspect;
    if (fileWidth > 0 && fileHeight > 0) {
      filePixelsRef.current = { width: fileWidth, height: fileHeight };
    }
    syncFrame();
  };

  const commitDisplay = (
    resolved: { src: string; tier: number },
    aspect: number,
    fileWidth: number,
    fileHeight: number,
    gen: number,
  ) => {
    if (loadGen.current !== gen) {
      return;
    }
    tierRef.current = resolved.tier;
    applyGeometry(aspect, fileWidth, fileHeight);
    if (displaySrcRef.current === resolved.src) {
      return;
    }
    setDisplaySrc(resolved.src);
    if (opening) {
      requestAnimationFrame(() => setOpening(false));
    }
  };

  const edgeBucket = Math.ceil(
    viewerNeededEdge(frame.width, frame.height, window.devicePixelRatio || 1) / 64,
  );

  useEffect(() => {
    if (nativeHold.current) {
      return;
    }
    const gen = loadGen.current;
    const needed = edgeBucket * 64;

    const paint = async (src: string, tier: number, quality: boolean) => {
      if (!src || loadGen.current !== gen || tier < tierRef.current) {
        return;
      }
      if (displaySrcRef.current === src) {
        tierRef.current = Math.max(tierRef.current, tier);
        if (quality) {
          markQualityFrame();
        }
        return;
      }
      const decodeStarted = tier >= NATIVE_TIER ? performance.now() : 0;
      try {
        await decodeImage(src);
      } catch {
        return;
      }
      if (decodeStarted > 0) {
        markWebviewDecode(performance.now() - decodeStarted);
      }
      if (loadGen.current !== gen || tier < tierRef.current) {
        return;
      }
      const known = filePixelsFromMeta();
      const aspect =
        known.width > 0 && known.height > 0 ? aspectFromMeta(meta) : displayAspectRef.current;
      tierRef.current = tier;
      applyGeometry(aspect, known.width, known.height);
      setDisplaySrc(src);
      markFirstFrame();
      if (quality) {
        markQualityFrame();
      }
    };

    void (async () => {
      let offer: ViewerOffer;
      try {
        offer = await invoke<ViewerOffer>("viewer_frame", {
          path: file.path,
          size: file.size,
          modifiedAt: file.modifiedAt,
          longEdge: needed,
        });
      } catch {
        return;
      }
      if (loadGen.current !== gen) {
        return;
      }
      if (offer.token > 0) {
        tokenRef.current = offer.token;
      }
      if (offer.sharpPath && offer.sharpEdge > tierRef.current) {
        await paint(convertFileSrc(offer.sharpPath), offer.sharpEdge, true);
      } else if (offer.previewPath && offer.previewEdge > tierRef.current) {
        await paint(convertFileSrc(offer.previewPath), offer.previewEdge, false);
      }
      if (loadGen.current !== gen) {
        return;
      }
      if (offer.nativePath) {
        const src = convertFileSrc(offer.nativePath);
        await paint(src, NATIVE_TIER, true);
        if (loadGen.current === gen && tierRef.current >= NATIVE_TIER) {
          nativeHold.current = true;
        }
      }
    })();
  }, [file.path, file.size, file.modifiedAt, edgeBucket]);

  useEffect(() => {
    const gen = loadGen.current;
    let unlisten: (() => void) | undefined;
    void listen<ViewerFrameEvent>("viewer-frame-ready", (event) => {
      if (event.payload.path !== filePathRef.current || event.payload.token !== tokenRef.current) {
        return;
      }
      if (loadGen.current !== gen || event.payload.longEdge < tierRef.current) {
        return;
      }
      const src = convertFileSrc(event.payload.framePath);
      void decodeImage(src)
        .then(() => {
          if (loadGen.current !== gen || event.payload.token !== tokenRef.current) {
            return;
          }
          if (event.payload.longEdge < tierRef.current) {
            return;
          }
          tierRef.current = event.payload.longEdge;
          setDisplaySrc(src);
          markFirstFrame();
          markQualityFrame();
        })
        .catch(() => undefined);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, [file.path]);

  useEffect(() => {
    if (!thumb || tierRef.current >= NATIVE_TIER) {
      return;
    }
    if (thumb.tier <= tierRef.current) {
      return;
    }
    const known = filePixelsFromMeta();
    if (known.width <= 0 || known.height <= 0) {
      return;
    }
    const gen = loadGen.current;
    const resolved = { src: convertFileSrc(thumb.thumbnailPath), tier: thumb.tier };
    void decodeImage(resolved.src).then(() => {
      if (loadGen.current !== gen || thumb.tier <= tierRef.current) {
        return;
      }
      const fromMeta = filePixelsFromMeta();
      const aspect =
        fromMeta.width > 0 && fromMeta.height > 0
          ? aspectFromMeta(meta)
          : displayAspectRef.current;
      commitDisplay(
        resolved,
        aspect,
        fromMeta.width,
        fromMeta.height,
        gen,
      );
    });
  }, [thumbVersion, thumb?.tier, thumb?.thumbnailPath]);

  const setShellRef = (node: HTMLDivElement | null) => {
    shellRef.current = node;
    node?.focus();
  };

  const updateNavEdge = (clientX: number) => {
    if (modalOpen) {
      setNavEdge(null);
      return;
    }
    const rect = frameRef.current?.getBoundingClientRect();
    const viewWidth = shellRef.current?.clientWidth ?? window.innerWidth;
    const fillsWidth = rect ? rect.width >= viewWidth - 4 : false;
    if (!rect || fillsWidth) {
      if (clientX < NAV_EDGE_PX && canGoPrev) {
        setNavEdge("left");
      } else if (clientX > window.innerWidth - NAV_EDGE_PX && canGoNext) {
        setNavEdge("right");
      } else {
        setNavEdge(null);
      }
      return;
    }
    if (clientX < rect.left && canGoPrev) {
      setNavEdge("left");
    } else if (clientX > rect.right && canGoNext) {
      setNavEdge("right");
    } else {
      setNavEdge(null);
    }
  };

  const updateToolbarPeek = (clientY: number) => {
    const fromBottom = toolbarPeekDistanceFromBottom(clientY);
    if (toolbarPeekShouldActivate(fromBottom)) {
      window.clearTimeout(toolbarHideTimer.current);
      toolbarHideTimer.current = 0;
      setToolbarVisible(true);
      return;
    }
    if (toolbarPeekShouldHide(fromBottom) && !toolbarHideTimer.current) {
      toolbarHideTimer.current = window.setTimeout(() => {
        setToolbarVisible(false);
        toolbarHideTimer.current = 0;
      }, 400);
    }
  };

  const onZoomOut = () => setZoomIndex((index) => Math.max(0, index - 1));
  const onZoomIn = () =>
    setZoomIndex((index) => Math.min(VIEWER_ZOOM_STEPS.length - 1, index + 1));

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (modalOpenRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const deltaY = event.deltaY;
      if (deltaY === 0) {
        return;
      }
      const oldIndex = zoomIndexRef.current;
      const newIndex =
        deltaY > 0
          ? Math.max(0, oldIndex - 1)
          : Math.min(VIEWER_ZOOM_STEPS.length - 1, oldIndex + 1);
      if (newIndex === oldIndex) {
        return;
      }
      const aspect = displayAspectRef.current;
      const oldScale = viewerZoomFromIndex(oldIndex);
      const newScale = viewerZoomFromIndex(newIndex);
      const { width: viewW, height: viewH } = viewSizeRef.current;
      const fill = fillScreenRef.current;
      const oldFrame = computeViewerFrame(aspect, viewW, viewH, fill, oldScale);
      const newFrame = computeViewerFrame(aspect, viewW, viewH, fill, newScale);
      const rect = shell.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      const panNow = panRef.current;
      const px = oldFrame.width > 0 ? (cx - panNow.x) / oldFrame.width : 0;
      const py = oldFrame.height > 0 ? (cy - panNow.y) / oldFrame.height : 0;
      let nextX = cx - px * newFrame.width;
      let nextY = cy - py * newFrame.height;
      const maxX = Math.max(0, (newFrame.width - viewW) / 2);
      const maxY = Math.max(0, (newFrame.height - viewH) / 2);
      setZoomIndex(newIndex);
      setPan({
        x: Math.min(maxX, Math.max(-maxX, nextX)),
        y: Math.min(maxY, Math.max(-maxY, nextY)),
      });
    };
    shell.addEventListener("wheel", onWheel, { passive: false });
    return () => shell.removeEventListener("wheel", onWheel);
  }, [file.path]);

  const setFillScreenMode = (value: boolean) => {
    fillScreenRef.current = value;
    setFillScreen(value);
  };

  const canPan = frame.width > viewSize.width + 2 || frame.height > viewSize.height + 2;
  const fillsWidth = frame.width >= viewSize.width - 4;
  const photoQuarters = rotationQuarters(meta);
  const photoStyle = viewerPhotoStyle(frame.width, frame.height, photoQuarters);

  function clampPan(x: number, y: number) {
    const maxX = Math.max(0, (frame.width - viewSize.width) / 2);
    const maxY = Math.max(0, (frame.height - viewSize.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  }

  return (
    <div
      ref={setShellRef}
      className={styles.viewer}
      data-modal-phase={motionPhase}
      data-viewer="true"
      style={{ "--viewer-fs-inset": `${fullscreenBottomInset}px` } as CSSProperties}
      data-app-fullscreen={appFullscreen ? "true" : "false"}
      data-fullscreen-phase={fullscreenPhase}
      data-layout-animate={layoutAnimating ? "true" : "false"}
      data-fill-screen={fillScreen ? "true" : "false"}
      data-nav-shade={fillsWidth ? "none" : "backdrop"}
      data-nav-left={navEdge === "left" ? "true" : undefined}
      data-nav-right={navEdge === "right" ? "true" : undefined}
      data-toolbar-visible={toolbarVisible ? "true" : "false"}
      onDragStart={(event) => event.preventDefault()}
      onClick={(event) => {
        if (modalOpen) {
          return;
        }
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) {
          onClose();
          return;
        }
        const action = viewerBackgroundClick(
          event.clientX,
          rect.left,
          rect.right,
          viewSize.width,
          canGoPrev,
          canGoNext,
        );
        if (action === "prev") {
          onNavigate(-1);
        } else if (action === "next") {
          onNavigate(1);
        } else if (action === "close") {
          onClose();
        }
      }}
      onMouseMove={(event) => {
        event.stopPropagation();
        updateNavEdge(event.clientX);
        updateToolbarPeek(event.clientY);
      }}
      onMouseLeave={(event) => {
        event.stopPropagation();
        setNavEdge(null);
        const shellRect = event.currentTarget.getBoundingClientRect();
        const fromBottom = toolbarPeekDistanceFromBottom(
          event.clientY,
          shellRect.bottom,
        );
        if (toolbarPeekShouldKeepOnLeave(fromBottom)) {
          window.clearTimeout(toolbarHideTimer.current);
          toolbarHideTimer.current = 0;
          return;
        }
        window.clearTimeout(toolbarHideTimer.current);
        toolbarHideTimer.current = window.setTimeout(() => {
          setToolbarVisible(false);
          toolbarHideTimer.current = 0;
        }, 400);
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (modalOpen) {
          return;
        }
        const target = event.target;
        if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
          return;
        }
        if (event.key === "ArrowRight" && canGoNext) {
          onNavigate(1);
        } else if (event.key === "ArrowLeft" && canGoPrev) {
          onNavigate(-1);
        }
      }}
      tabIndex={0}
    >
      <div
        className={styles.navEdgeLeft}
        onMouseMove={(event) => updateNavEdge(event.clientX)}
        aria-hidden={!canGoPrev}
      >
        <button
          type="button"
          className={styles.navButton}
          aria-label={t("viewer.previousAria")}
          disabled={!canGoPrev}
          onClick={(event) => {
            event.stopPropagation();
            if (canGoPrev) {
              onNavigate(-1);
            }
          }}
        >
          <StitchVueIcon name="viewer-previous" className={styles.navIcon} />
        </button>
      </div>
      <div
        className={styles.navEdgeRight}
        onMouseMove={(event) => updateNavEdge(event.clientX)}
        aria-hidden={!canGoNext}
      >
        <button
          type="button"
          className={styles.navButton}
          aria-label={t("viewer.nextAria")}
          disabled={!canGoNext}
          onClick={(event) => {
            event.stopPropagation();
            if (canGoNext) {
              onNavigate(1);
            }
          }}
        >
          <StitchVueIcon name="viewer-next" className={styles.navIcon} />
        </button>
      </div>
      {!displaySrc ? <p className={styles.loading}>{t("common.loading")}</p> : null}
      <div
        ref={frameRef}
        className={styles.frame}
        data-grab={canPan ? (grabbing ? "grabbing" : "grab") : undefined}
        data-ready={displaySrc ? "true" : "false"}
        style={{ width: frame.width, height: frame.height, transform: `translate(${pan.x}px, ${pan.y}px)` }}
        data-opening={opening ? "true" : undefined}
      >
        {displaySrc ? (
          <img
            className={styles.photo}
            src={displaySrc}
            alt={file.name}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            style={photoStyle}
            onPointerDown={(event) => {
              if (!canPan || event.button !== 0) {
                return;
              }
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              panDrag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
              setGrabbing(true);
            }}
            onPointerMove={(event) => {
              const drag = panDrag.current;
              if (!drag) {
                return;
              }
              const dx = event.clientX - drag.x;
              const dy = event.clientY - drag.y;
              if (Math.hypot(dx, dy) > 4) {
                drag.moved = true;
              }
              if (drag.moved) {
                setPan(clampPan(drag.panX + dx, drag.panY + dy));
              }
            }}
            onPointerUp={() => {
              if (panDrag.current?.moved) {
                suppressClick.current = true;
              }
              panDrag.current = null;
              setGrabbing(false);
            }}
            onClick={(event) => {
              if (suppressClick.current) {
                event.stopPropagation();
                suppressClick.current = false;
              }
            }}
          />
        ) : null}
      </div>
      {toolbarExtra ? (
        <div className={styles.actionDock} onClick={(event) => event.stopPropagation()}>
          {toolbarExtra}
        </div>
      ) : null}
      <div
        className={styles.bottomBarDock}
        onMouseEnter={() => {
          window.clearTimeout(toolbarHideTimer.current);
          toolbarHideTimer.current = 0;
          setToolbarVisible(true);
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <ViewerControlBar
          zoomIndex={zoomIndex}
          zoomSteps={VIEWER_ZOOM_STEPS.length}
          fillScreen={fillScreen}
          onZoomIndex={setZoomIndex}
          onZoomOut={onZoomOut}
          onZoomIn={onZoomIn}
          onToggleFillScreen={() => {
            const next = !fillScreenRef.current;
            setFillScreenMode(next);
            setZoomIndex(viewerZoomIndex(1));
            requestAnimationFrame(() => syncFrame());
          }}
          appFullscreen={appFullscreen}
          onToggleFullscreen={toggleAppFullscreen}
          onRotate={onRotate}
          onOpenProperties={onOpenProperties}
          favoriteOn={favoriteOn}
          favoriteDisabled={favoriteDisabled}
          onFavorite={onFavorite}
          deleteDisabled={deleteDisabled}
          onDelete={onDelete}
          restoreDisabled={restoreDisabled}
          onRestore={onRestore}
          recycleDisabled={recycleDisabled}
          onRecycleToWindows={onRecycleToWindows}
        />
      </div>
    </div>
  );
}
