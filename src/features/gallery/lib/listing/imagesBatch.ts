import type { DirectoryView } from "../../../../entities/folder/types";
import type { ImageFile } from "../../../../entities/image/types";

export type ImagesBatchEvent = {
  session: number;
  folder: string;
  phase: string;
  files: ImageFile[];
};

/** Merge a names/stats chunk into a discovered listing. The published gallery list is the complete `browse_directory` result, not these batches. */
export function applyImagesBatch(current: DirectoryView, payload: ImagesBatchEvent): DirectoryView {
  if (payload.phase === "stats") {
    const stats = new Map(payload.files.map((file) => [file.path, file]));
    return {
      ...current,
      images: current.images.map((file) => stats.get(file.path) ?? file),
    };
  }
  const known = new Set(current.images.map((file) => file.path));
  const added = payload.files.filter((file) => !known.has(file.path));
  if (added.length === 0) {
    return current;
  }
  return {
    ...current,
    path: payload.folder,
    images: [...current.images, ...added],
  };
}
