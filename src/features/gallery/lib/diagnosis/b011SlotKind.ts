import type { ThumbInfo } from "../../../../entities/image/types";
import { thumbIsDisplayReady } from "../thumbnails/folderThumbnailsPending.ts";

/** React-layer classification for B-011 (DOM blank-img is separate). */
export type B011ReactSlotKind =
  | "layout-hole"
  | "placeholder-waiting"
  | "placeholder-failed"
  | "thumb-in-map"
  | "no-file";

export function classifyB011ReactSlot(input: {
  file: { path: string } | null | undefined;
  thumb: ThumbInfo | undefined;
  failed: string | undefined;
  layoutTileRendered: boolean;
}): B011ReactSlotKind {
  if (!input.file) {
    return "no-file";
  }
  if (!input.layoutTileRendered) {
    return "layout-hole";
  }
  if (input.failed) {
    return "placeholder-failed";
  }
  if (thumbIsDisplayReady(input.thumb)) {
    return "thumb-in-map";
  }
  return "placeholder-waiting";
}

/** Mosaic published prefix: indices at or above `publishedEnd` have no layout tile. */
export function mosaicIndexPublished(index: number, publishedEnd: number): boolean {
  return index >= 0 && index < publishedEnd;
}
