import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ImageFile, ThumbInfo } from "../../../../entities/image/types";
import {
  cancelNativeWarm,
  emptyNativeWarm,
  finishNativeWarm,
  forgetNativeWarm,
  promoteNativeWarm,
  requestNativeWarm,
  retainNativeWarm,
  type NativeWarmState,
} from "../pipeline/nativeWarm";
import {
  buildNeighborContext,
  buildNeighborJobs,
  neighborContextEquals,
  resolveNeighborSource,
  shouldSkipReadyDecode,
  type CancelReason,
  type NeighborContext,
  type NeighborDirection,
  type NeighborJob,
} from "./viewerPreloadLogic";

type ViewerSource = { kind: string; path: string };

const MAX_ACTIVE = 2;
const MAX_KEPT = 8;

function toAssetSrc(path: string): string {
  if (typeof window === "undefined" || !(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return `asset://localhost/${encodeURIComponent(path)}`;
  }
  return convertFileSrc(path);
}

export type PreloadDiagnostics = {
  started: number;
  warmed: number;
  cancelled: number;
  cancelReasons: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  hoverToReadyMs: number[];
  neighborsReadyMs: number[];
};

let generation = 0;
let active = 0;
let photoEpoch = 0;
let warm: NativeWarmState = emptyNativeWarm();
const warmSrc = new Map<string, { src: string; native: boolean }>();
const kept = new Map<string, { image: HTMLImageElement; native: boolean; src: string }>();

let currentContext: NeighborContext | null = null;
let queue: NeighborJob[] = [];
let waiting = new Map<string, NeighborJob>();
let protect = new Set<string>();
let latestThumbs: ReadonlyMap<string, ThumbInfo> = new Map();
let neighborsStartedAt = 0;
let neighborsReadyNoted = false;

let diagnostics: PreloadDiagnostics = emptyDiagnostics();

function emptyDiagnostics(): PreloadDiagnostics {
  return {
    started: 0,
    warmed: 0,
    cancelled: 0,
    cancelReasons: {},
    cacheHits: 0,
    cacheMisses: 0,
    hoverToReadyMs: [],
    neighborsReadyMs: [],
  };
}

export function getPreloadDiagnostics(): PreloadDiagnostics {
  return {
    ...diagnostics,
    cancelReasons: { ...diagnostics.cancelReasons },
    hoverToReadyMs: diagnostics.hoverToReadyMs.slice(),
    neighborsReadyMs: diagnostics.neighborsReadyMs.slice(),
  };
}

export function resetPreloadDiagnostics() {
  diagnostics = emptyDiagnostics();
}

function noteCancel(reason: CancelReason) {
  diagnostics.cancelled += 1;
  diagnostics.cancelReasons[reason] = (diagnostics.cancelReasons[reason] ?? 0) + 1;
}

function noteHoverReady(startedAt: number) {
  if (startedAt <= 0) {
    return;
  }
  diagnostics.hoverToReadyMs.push(Math.max(0, performance.now() - startedAt));
  if (diagnostics.hoverToReadyMs.length > 32) {
    diagnostics.hoverToReadyMs.shift();
  }
}

function noteNeighborsReady() {
  if (neighborsReadyNoted || neighborsStartedAt <= 0) {
    return;
  }
  if (waiting.size > 0 || queue.length > 0 || active > 0) {
    return;
  }
  neighborsReadyNoted = true;
  diagnostics.neighborsReadyMs.push(Math.max(0, performance.now() - neighborsStartedAt));
  if (diagnostics.neighborsReadyMs.length > 32) {
    diagnostics.neighborsReadyMs.shift();
  }
}

export function cancelViewerPreload(options?: { clearCache?: boolean; reason?: CancelReason }) {
  generation += 1;
  queue = [];
  waiting.clear();
  currentContext = null;
  neighborsStartedAt = 0;
  neighborsReadyNoted = false;
  noteCancel(options?.reason ?? (options?.clearCache ? "folder" : "viewer-close"));
  if (options?.clearCache) {
    kept.clear();
    warmSrc.clear();
    warm = emptyNativeWarm();
  }
}

export function beginPhotoWarm(): number {
  photoEpoch += 1;
  warm = cancelNativeWarm(warm);
  return photoEpoch;
}

export function cancelPhotoWarm() {
  photoEpoch += 1;
  warm = cancelNativeWarm(warm);
  noteCancel("hover-cancel");
}

export function photoWarmEpoch(): number {
  return photoEpoch;
}

export function promotePreloaded(path: string) {
  const before = warm.kept.slice();
  warm = promoteNativeWarm(warm, path);
  dropEvicted(before, warm.kept);
  const entry = kept.get(path);
  if (!entry) {
    return;
  }
  kept.delete(path);
  kept.set(path, entry);
}

export function rememberPreloaded(path: string, src: string, native: boolean, timing?: { hoverStartedAt?: number }) {
  if (!path || !src) {
    return;
  }
  const current = kept.get(path);
  if (
    shouldSkipReadyDecode({
      currentSrc: current?.src ?? null,
      currentNative: current?.native ?? false,
      currentReady: Boolean(current && current.image.naturalWidth > 0),
      nextSrc: src,
      nextNative: native,
    })
  ) {
    const before = warm.kept.slice();
    warm = retainNativeWarm(warm, path);
    dropEvicted(before, warm.kept);
    if (current) {
      kept.delete(path);
      kept.set(path, current);
    }
    diagnostics.cacheHits += 1;
    if (timing?.hoverStartedAt) {
      noteHoverReady(timing.hoverStartedAt);
    }
    return;
  }
  if (current) {
    kept.delete(path);
  }
  warm = forgetNativeWarm(warm, path);
  warmSrc.set(path, { src, native });
  const before = warm.kept.slice();
  const planned = requestNativeWarm(warm, path);
  warm = planned.state;
  dropEvicted(before, warm.kept);
  diagnostics.started += 1;
  if (planned.start) {
    beginDecode(planned.start, timing?.hoverStartedAt);
  }
}

export function peekPreloaded(path: string): { src: string; native: boolean } | null {
  const entry = kept.get(path);
  if (!entry || entry.image.naturalWidth <= 0) {
    return null;
  }
  return { src: entry.image.src, native: entry.native };
}

/**
 * Prepares a short window around the open photo.
 * Neighbors ahead of the open photo decode through WebView when that format can.
 * Farther frames stay on the cached preview.
 * Thumbnail updates refresh waiting jobs without bumping generation.
 */
export function preloadViewerNeighbors(
  files: readonly ImageFile[],
  index: number,
  ahead: number,
  direction: NeighborDirection,
  fast: boolean,
  thumbs: ReadonlyMap<string, ThumbInfo>,
  orderStamp = "",
) {
  latestThumbs = thumbs;
  const next = buildNeighborContext(files, index, ahead, direction, fast, orderStamp);
  if (!next.openPath) {
    cancelViewerPreload({ reason: "context" });
    return;
  }
  if (neighborContextEquals(currentContext, next)) {
    resumeWaiting(thumbs);
    return;
  }
  if (currentContext) {
    noteCancel("context");
  }
  generation += 1;
  const token = generation;
  currentContext = next;
  const planned = buildNeighborJobs(files, index, ahead, direction, fast);
  queue = planned.jobs.filter((job) => !isReadyKept(job.file.path));
  waiting.clear();
  protect = new Set(planned.protect);
  neighborsStartedAt = performance.now();
  neighborsReadyNoted = false;
  pump(token);
}

/** Late thumbnail arrivals resume waiting neighbor jobs without cancelling the queue. */
export function notifyNeighborThumbs(thumbs: ReadonlyMap<string, ThumbInfo>) {
  latestThumbs = thumbs;
  if (!currentContext) {
    return;
  }
  resumeWaiting(thumbs);
}

function resumeWaiting(thumbs: ReadonlyMap<string, ThumbInfo>) {
  if (waiting.size === 0) {
    pump(generation);
    return;
  }
  const ready: NeighborJob[] = [];
  for (const [path, job] of waiting) {
    if (thumbs.has(path) || isReadyKept(path)) {
      waiting.delete(path);
      if (!isReadyKept(path)) {
        ready.push(job);
      }
    }
  }
  if (ready.length > 0) {
    queue = [...ready, ...queue];
  }
  pump(generation);
}

function isReadyKept(path: string): boolean {
  const entry = kept.get(path);
  return Boolean(entry && entry.image.naturalWidth > 0);
}

function pump(token: number) {
  if (token !== generation) {
    return;
  }
  while (active < MAX_ACTIVE && queue.length > 0) {
    const job = queue.shift();
    if (!job) {
      continue;
    }
    if (isReadyKept(job.file.path) || waiting.has(job.file.path)) {
      continue;
    }
    active += 1;
    diagnostics.started += 1;
    void loadOne(job, token).finally(() => {
      active = Math.max(0, active - 1);
      trimKept(protect);
      if (token === generation) {
        pump(token);
        noteNeighborsReady();
      }
    });
  }
  trimKept(protect);
  noteNeighborsReady();
}

function createWarmImage(src: string): { image: HTMLImageElement; decode(): Promise<void> } {
  if (typeof Image === "undefined") {
    const image = { src, naturalWidth: 1, decoding: "async" } as HTMLImageElement;
    return { image, decode: async () => undefined };
  }
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return {
    image,
    decode: () => image.decode().then(() => undefined),
  };
}

function beginDecode(path: string, hoverStartedAt?: number) {
  const job = warmSrc.get(path);
  if (!job) {
    const before = warm.kept.slice();
    const done = finishNativeWarm(warm);
    warm = done.state;
    dropEvicted(before, warm.kept);
    if (done.start) {
      beginDecode(done.start, hoverStartedAt);
    }
    return;
  }
  const existing = kept.get(path);
  if (
    shouldSkipReadyDecode({
      currentSrc: existing?.src ?? null,
      currentNative: existing?.native ?? false,
      currentReady: Boolean(existing && existing.image.naturalWidth > 0),
      nextSrc: job.src,
      nextNative: job.native,
    })
  ) {
    diagnostics.cacheHits += 1;
    const before = warm.kept.slice();
    const done = finishNativeWarm(warm);
    warm = done.state;
    dropEvicted(before, warm.kept);
    if (hoverStartedAt) {
      noteHoverReady(hoverStartedAt);
    }
    if (done.start) {
      beginDecode(done.start, hoverStartedAt);
    }
    return;
  }
  const { image, decode } = createWarmImage(job.src);
  kept.set(path, { image, native: job.native, src: job.src });
  trimKept(new Set(warm.kept));
  void decode()
    .then(() => {
      diagnostics.warmed += 1;
      if (hoverStartedAt) {
        noteHoverReady(hoverStartedAt);
      }
    })
    .catch(() => {
      if (kept.get(path)?.image === image) {
        kept.delete(path);
        warm = forgetNativeWarm(warm, path);
      }
    })
    .finally(() => {
      const before = warm.kept.slice();
      const done = finishNativeWarm(warm);
      warm = done.state;
      dropEvicted(before, warm.kept);
      if (done.start) {
        beginDecode(done.start);
      }
    });
}

function dropEvicted(before: readonly string[], after: readonly string[]) {
  const stay = new Set(after);
  for (const path of before) {
    if (!stay.has(path)) {
      kept.delete(path);
      warmSrc.delete(path);
    }
  }
}

function trimKept(protectSet: ReadonlySet<string>) {
  for (const path of [...kept.keys()]) {
    if (kept.size <= MAX_KEPT) {
      break;
    }
    if (!protectSet.has(path)) {
      kept.delete(path);
    }
  }
}

async function loadOne(job: NeighborJob, token: number) {
  if (token !== generation) {
    return;
  }
  const thumb = latestThumbs.get(job.file.path);
  if (!job.near && !thumb) {
    diagnostics.cacheMisses += 1;
    waiting.set(job.file.path, job);
    return;
  }
  let source: ViewerSource | null = null;
  if (job.near || !thumb) {
    try {
      source = await invoke<ViewerSource>("viewer_source", {
        path: job.file.path,
        size: job.file.size,
        modifiedAt: job.file.modifiedAt,
        previewOnly: !job.near,
      });
    } catch {
      source = null;
    }
    if (token !== generation) {
      return;
    }
  }
  const resolved = resolveNeighborSource({ near: job.near, thumb, source });
  if (resolved.status === "wait") {
    diagnostics.cacheMisses += 1;
    waiting.set(job.file.path, job);
    return;
  }
  if (resolved.status === "skip") {
    diagnostics.cacheMisses += 1;
    return;
  }
  const src = toAssetSrc(resolved.srcKey);
  if (
    shouldSkipReadyDecode({
      currentSrc: kept.get(job.file.path)?.src ?? null,
      currentNative: kept.get(job.file.path)?.native ?? false,
      currentReady: isReadyKept(job.file.path),
      nextSrc: src,
      nextNative: resolved.native,
    })
  ) {
    diagnostics.cacheHits += 1;
    return;
  }
  if (resolved.cacheHit) {
    diagnostics.cacheHits += 1;
  } else {
    diagnostics.cacheMisses += 1;
  }
  const { image, decode } = createWarmImage(src);
  kept.set(job.file.path, { image, native: resolved.native, src });
  try {
    await decode();
    if (token !== generation) {
      return;
    }
    diagnostics.warmed += 1;
  } catch {
    if (kept.get(job.file.path)?.image === image) {
      kept.delete(job.file.path);
    }
  }
}

/** Test/debug helper: paths waiting for a late thumbnail or source. */
export function waitingNeighborPaths(): string[] {
  return [...waiting.keys()];
}
