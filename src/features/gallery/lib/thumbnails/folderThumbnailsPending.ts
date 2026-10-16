import type { ImageFile, ThumbInfo } from "../../../../entities/image/types";
import { pathKey } from "../../../selection/lib/selection.ts";

/** Minimum tier that can paint a gallery tile (not a placeholder). */
export const MIN_DISPLAY_TIER = 256;

export type PipelinePassName = "idle" | "running" | "paused" | "completed" | "cancelled" | string;

export type FolderThumbProgressInput = {
  listingBusy: boolean;
  imageCount: number;
  settledCount: number;
  /** Authoritative board counters from `pipeline_stats`; null until first poll. */
  pipelinePending: number | null;
  pipelinePass: PipelinePassName | null;
  cacheCapped: boolean;
};

export function thumbIsDisplayReady(info: ThumbInfo | undefined): boolean {
  return Boolean(info && info.tier >= MIN_DISPLAY_TIER);
}

export function imageIsThumbSettled(
  path: string,
  thumbs: Map<string, ThumbInfo>,
  failed: Map<string, string>,
): boolean {
  if (failed.has(path)) {
    return true;
  }
  return thumbIsDisplayReady(thumbs.get(path));
}

/** Incremental seed: unique path keys for images that already have a min preview or a terminal fail. */
export function seedSettledThumbKeys(
  images: readonly ImageFile[],
  thumbs: Map<string, ThumbInfo>,
  failed: Map<string, string>,
): Set<string> {
  const settled = new Set<string>();
  for (const image of images) {
    if (imageIsThumbSettled(image.path, thumbs, failed)) {
      settled.add(pathKey(image.path));
    }
  }
  return settled;
}

/**
 * True while the folder listing is open or any photo still lacks a displayable base preview
 * and the pipeline has not reached a terminal pass.
 *
 * Quality upgrades (512/1024) must not keep this true once the base tier is settled.
 *
 * Do not treat `idle` or `pending === 0` alone as done: after `begin_directory_session`
 * the board is empty/idle until `start_indexing` fills it. Terminal signals are
 * `completed` / `cancelled` (and `cacheCapped`, which stops background P5 work).
 */
export function folderThumbnailsPending(input: FolderThumbProgressInput): boolean {
  if (input.listingBusy) {
    return true;
  }
  if (input.imageCount <= 0) {
    return false;
  }
  if (input.settledCount >= input.imageCount) {
    return false;
  }

  const pass = input.pipelinePass;
  if (pass === "completed" || pass === "cancelled") {
    return false;
  }
  if (input.cacheCapped) {
    return false;
  }
  return true;
}

/** Returns whether the key was newly added (false on quality-upgrade duplicates). */
export function markThumbSettled(settled: Set<string>, path: string): boolean {
  const key = pathKey(path);
  if (settled.has(key)) {
    return false;
  }
  settled.add(key);
  return true;
}
