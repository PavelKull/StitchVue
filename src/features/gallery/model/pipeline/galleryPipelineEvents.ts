import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { DirectoryView } from "../../../../entities/folder/types";
import type { ImageMeta, ThumbInfo } from "../../../../entities/image/types";
import { type ImagesBatchEvent } from "../../lib/listing/imagesBatch";
import type { FileOperationProgress } from "../../../selection/lib/fileOperation";
import { pathKey } from "../../../selection/lib/selection";
import { eventSessionIsCurrent, keepCurrentSession } from "../../lib/directory/directorySession";
import { MIN_DISPLAY_TIER } from "../../lib/thumbnails/folderThumbnailsPending";
import { mergeMetaFromScanner } from "../../lib/pipeline/metaBatch";

export type MetaEvent = { session: number; path: string; width: number; height: number };
export type ThumbEvent = { session: number; path: string; tier: number; thumbnailPath: string };
export type FailEvent = { session: number; path: string; reason: string };
export type { ImagesBatchEvent } from "../../lib/listing/imagesBatch";

type PendingThumb = ThumbInfo & { session: number };

export async function flushThumbnailBatch(
  pending: Map<string, PendingThumb>,
  target: Map<string, ThumbInfo>,
  done: () => void,
  onBaseReady?: (path: string, tier: number, session: number) => void,
) {
  const batch = [...pending.entries()];
  pending.clear();
  await Promise.all(
    batch.map(async ([path, info]) => {
      const stored: ThumbInfo = { tier: info.tier, thumbnailPath: info.thumbnailPath };
      const image = new Image();
      image.src = convertFileSrc(info.thumbnailPath);
      try {
        await image.decode();
        const current = target.get(path);
        if (!current || info.tier >= current.tier) {
          target.set(path, stored);
          if (info.tier >= MIN_DISPLAY_TIER) {
            onBaseReady?.(path, info.tier, info.session);
          }
        }
      } catch {
        target.set(path, stored);
        if (info.tier >= MIN_DISPLAY_TIER) {
          onBaseReady?.(path, info.tier, info.session);
        }
      }
    }),
  );
  done();
}

export type GalleryPipelineListenRefs = {
  requestId: MutableRefObject<number>;
  scanFolderRef: MutableRefObject<string | null>;
  metaRef: MutableRefObject<Map<string, ImageMeta>>;
  thumbsRef: MutableRefObject<Map<string, ThumbInfo>>;
  failedRef: MutableRefObject<Map<string, string>>;
  viewRef: MutableRefObject<DirectoryView>;
  refreshRef: MutableRefObject<(path: string) => void>;
  /** Optional star refetch on folder-changed when session + open folder match (CL-P02). */
  favoritesRefetchRef?: MutableRefObject<(path: string) => void>;
  /** Progress events only compare `id`; callers may store extra fields (e.g. action). */
  fileOperationRef: { readonly current: { id: string } | null };
  thumbSeen: MutableRefObject<boolean>;
  noteThumbTimingRef: MutableRefObject<() => void>;
  listingRescanRef: MutableRefObject<boolean>;
  /** Called after a base-tier (or higher) thumb is written into thumbsRef. Session-filtered by caller. */
  noteBaseThumbReadyRef?: MutableRefObject<(path: string, session: number) => void>;
  /** Called when a file reaches a terminal thumbnail failure. */
  noteThumbFailedRef?: MutableRefObject<(path: string, session: number) => void>;
};

export type GalleryPipelineListenSetters = {
  setMetaVersion: Dispatch<SetStateAction<number>>;
  setThumbVersion: Dispatch<SetStateAction<number>>;
  setFailedVersion: Dispatch<SetStateAction<number>>;
  setView: Dispatch<SetStateAction<DirectoryView>>;
  setFileProgress: Dispatch<SetStateAction<FileOperationProgress | null>>;
};

/** One mount: Tauri pipeline events for the open directory session. */
export function useGalleryPipelineEvents(
  refs: GalleryPipelineListenRefs,
  setters: GalleryPipelineListenSetters,
  onListenersReady?: () => void,
) {
  const onReadyRef = useRef(onListenersReady);
  onReadyRef.current = onListenersReady;

  useEffect(() => {
    const pending = new Map<string, PendingThumb>();
    let thumbFrame = 0;
    let metaFlush = 0;
    let cancelled = false;

    const flushMetaVersion = () => {
      if (!metaFlush) {
        return;
      }
      window.cancelAnimationFrame(metaFlush);
      metaFlush = 0;
      setters.setMetaVersion((value) => value + 1);
    };

    const unlistenMeta = listen<MetaEvent[]>("metadata-batch", (event) => {
      const items = keepCurrentSession(event.payload, refs.requestId.current);
      if (items.length === 0) {
        return;
      }
      for (const item of items) {
        const prev = refs.metaRef.current.get(item.path);
        refs.metaRef.current.set(item.path, mergeMetaFromScanner(prev, item.width, item.height));
      }
      if (metaFlush) {
        return;
      }
      metaFlush = window.requestAnimationFrame(() => {
        metaFlush = 0;
        setters.setMetaVersion((value) => value + 1);
      });
    });

    const unlistenThumb = listen<ThumbEvent>("thumbnail-ready", (event) => {
      if (!eventSessionIsCurrent(event.payload.session, refs.requestId.current)) {
        return;
      }
      const current = refs.thumbsRef.current.get(event.payload.path);
      if (current && current.tier >= event.payload.tier) {
        return;
      }
      pending.set(event.payload.path, {
        tier: event.payload.tier,
        thumbnailPath: event.payload.thumbnailPath,
        session: event.payload.session,
      });
      const firstPaint = !refs.thumbSeen.current && refs.thumbsRef.current.size === 0;
      const afterFlush = () => {
        refs.noteThumbTimingRef.current();
        setters.setThumbVersion((value) => value + 1);
      };
      const onBaseReady = (path: string, _tier: number, session: number) => {
        refs.noteBaseThumbReadyRef?.current(path, session);
      };
      if (firstPaint) {
        refs.thumbSeen.current = true;
        void flushThumbnailBatch(pending, refs.thumbsRef.current, afterFlush, onBaseReady);
        return;
      }
      if (thumbFrame) {
        return;
      }
      thumbFrame = window.requestAnimationFrame(() => {
        thumbFrame = 0;
        void flushThumbnailBatch(pending, refs.thumbsRef.current, afterFlush, onBaseReady);
      });
    });

    const unlistenFail = listen<FailEvent>("thumbnail-failed", (event) => {
      if (!eventSessionIsCurrent(event.payload.session, refs.requestId.current)) {
        return;
      }
      refs.failedRef.current.set(event.payload.path, event.payload.reason);
      refs.noteThumbFailedRef?.current(event.payload.path, event.payload.session);
      setters.setFailedVersion((value) => value + 1);
    });

    const unlistenImages = listen<ImagesBatchEvent>("images-batch", (event) => {
      if (!eventSessionIsCurrent(event.payload.session, refs.requestId.current)) {
        return;
      }
      if (refs.listingRescanRef.current) {
        return;
      }
      const folder = refs.scanFolderRef.current;
      if (!folder || pathKey(event.payload.folder) !== pathKey(folder)) {
        return;
      }
      // Published order comes from browse_directory. Streaming names/stats must
      // not reshuffle tiles that already reached the grid.
    });

    const unlistenFolder = listen<{ folder: string; session: number }>("folder-changed", (event) => {
      if (!eventSessionIsCurrent(event.payload.session, refs.requestId.current)) {
        return;
      }
      if (refs.viewRef.current.path && pathKey(event.payload.folder) === pathKey(refs.viewRef.current.path)) {
        refs.refreshRef.current(event.payload.folder);
        refs.favoritesRefetchRef?.current(event.payload.folder);
      }
    });

    const unlistenOperation = listen<FileOperationProgress>("file-operation-progress", (event) => {
      if (refs.fileOperationRef.current && event.payload.operationId !== refs.fileOperationRef.current.id) {
        return;
      }
      setters.setFileProgress(event.payload);
    });

    const subscriptions = [
      unlistenMeta,
      unlistenThumb,
      unlistenFail,
      unlistenImages,
      unlistenFolder,
      unlistenOperation,
    ];
    void Promise.all(subscriptions).then(
      () => {
        if (!cancelled) {
          onReadyRef.current?.();
        }
      },
      () => {
        // Still unblock bootstrap load if a subscription fails to attach.
        if (!cancelled) {
          onReadyRef.current?.();
        }
      },
    );

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(thumbFrame);
      flushMetaVersion();
      for (const pendingStop of subscriptions) {
        void pendingStop.then(
          (stop) => stop(),
          () => undefined,
        );
      }
    };
    // Refs and React setState dispatchers are stable; listeners read `.current` each event.
  }, []);
}
