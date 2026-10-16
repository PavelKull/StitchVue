import type { ImageFile, ThumbInfo } from "../../../../entities/image/types";

export type NeighborDirection = 1 | -1;

export type NeighborContext = {
  openPath: string;
  orderStamp: string;
  ahead: number;
  direction: NeighborDirection;
  fast: boolean;
};

export type NeighborJob = {
  file: ImageFile;
  near: boolean;
};

export type ResolvedNeighborSource =
  | { status: "ready"; srcKey: string; native: boolean; cacheHit: boolean }
  | { status: "wait" }
  | { status: "skip" };

export type HoverFrameAccept = {
  path: string;
  token: number;
  epoch: number;
  pendingPath: string | null;
  pendingToken: number;
  pendingEpoch: number;
  /** Session that was live when the hover started. */
  pendingFolderSession: number;
  /** Session that is live now. */
  folderSession: number;
  /** Session carried by the Rust event when present. */
  eventSession: number;
};

export type CancelReason =
  | "context"
  | "folder"
  | "viewer-close"
  | "superseded"
  | "dispose"
  | "hover-cancel";

export function neighborContextEquals(left: NeighborContext | null, right: NeighborContext): boolean {
  if (!left) {
    return false;
  }
  return (
    left.openPath === right.openPath &&
    left.orderStamp === right.orderStamp &&
    left.ahead === right.ahead &&
    left.direction === right.direction &&
    left.fast === right.fast
  );
}

export function buildNeighborContext(
  files: readonly ImageFile[],
  index: number,
  ahead: number,
  direction: NeighborDirection,
  fast: boolean,
  orderStamp: string,
): NeighborContext {
  return {
    openPath: files[index]?.path ?? "",
    orderStamp,
    ahead: Math.max(1, ahead),
    direction,
    fast,
  };
}

export function collectNeighbors(
  files: readonly ImageFile[],
  index: number,
  ahead: number,
  direction: NeighborDirection,
): { forward: ImageFile[]; backward: ImageFile[] } {
  const step: NeighborDirection = direction < 0 ? -1 : 1;
  return {
    forward: collect(files, index, step, Math.max(1, ahead)),
    backward: collect(files, index, -step as NeighborDirection, 2),
  };
}

export function buildNeighborJobs(
  files: readonly ImageFile[],
  index: number,
  ahead: number,
  direction: NeighborDirection,
  fast: boolean,
): { jobs: NeighborJob[]; protect: string[]; near: Set<string> } {
  const { forward, backward } = collectNeighbors(files, index, ahead, direction);
  const near = new Set(fast ? [] : forward.slice(0, 2).map((file) => file.path));
  const jobs: NeighborJob[] = [...forward, ...backward].map((file) => ({
    file,
    near: near.has(file.path),
  }));
  const protect = [files[index]?.path, ...forward.slice(0, 2).map((file) => file.path), ...backward.map((file) => file.path)].filter(
    (path): path is string => Boolean(path),
  );
  return { jobs, protect, near };
}

export function resolveNeighborSource(input: {
  near: boolean;
  thumb: ThumbInfo | undefined;
  source: { kind: string; path: string } | null;
}): ResolvedNeighborSource {
  const { near, thumb, source } = input;
  if (!near && thumb) {
    return { status: "ready", srcKey: thumb.thumbnailPath, native: false, cacheHit: true };
  }
  if (source) {
    if (near && source.kind === "native" && source.path) {
      return { status: "ready", srcKey: source.path, native: true, cacheHit: true };
    }
    if (source.kind === "prepared" && source.path) {
      return { status: "ready", srcKey: source.path, native: false, cacheHit: true };
    }
  }
  if (thumb) {
    return { status: "ready", srcKey: thumb.thumbnailPath, native: false, cacheHit: true };
  }
  if (!source || source.kind === "pending" || !source.path) {
    return { status: "wait" };
  }
  return { status: "skip" };
}

export function shouldSkipReadyDecode(input: {
  currentSrc: string | null;
  currentNative: boolean;
  currentReady: boolean;
  nextSrc: string;
  nextNative: boolean;
}): boolean {
  if (!input.currentReady || !input.currentSrc) {
    return false;
  }
  if (input.currentSrc === input.nextSrc) {
    return true;
  }
  if (input.currentNative && !input.nextNative) {
    return true;
  }
  return false;
}

export function shouldAcceptHoverFrame(input: HoverFrameAccept): boolean {
  if (input.pendingFolderSession !== input.folderSession) {
    return false;
  }
  if (input.folderSession !== input.eventSession) {
    return false;
  }
  if (input.epoch !== input.pendingEpoch) {
    return false;
  }
  if (!input.pendingPath || input.pendingPath !== input.path) {
    return false;
  }
  if (input.pendingToken > 0 && input.token > 0 && input.pendingToken !== input.token) {
    return false;
  }
  return true;
}

export function pickHoverWarmSource(offer: {
  nativePath?: string;
  sharpPath?: string;
  previewPath?: string;
}): { path: string; native: boolean } | null {
  if (offer.nativePath) {
    return { path: offer.nativePath, native: true };
  }
  if (offer.sharpPath) {
    return { path: offer.sharpPath, native: false };
  }
  if (offer.previewPath) {
    return { path: offer.previewPath, native: false };
  }
  return null;
}

function collect(files: readonly ImageFile[], index: number, step: number, depth: number): ImageFile[] {
  const chosen: ImageFile[] = [];
  for (let cursor = index + step, left = depth; left > 0 && cursor >= 0 && cursor < files.length; cursor += step, left -= 1) {
    chosen.push(files[cursor]);
  }
  return chosen;
}
