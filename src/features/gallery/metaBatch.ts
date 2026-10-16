import type { ImageMeta } from "../../entities/image/types";

/** Merge scanner dimensions into gallery meta without dropping display-only fields. */
export function mergeMetaFromScanner(prev: ImageMeta | undefined, width: number, height: number): ImageMeta {
  return {
    width,
    height,
    rotationQuarters: prev?.rotationQuarters,
  };
}
