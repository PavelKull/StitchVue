import type { DirectoryView } from "../../../../entities/folder/types.ts";
import type { ImageFile } from "../../../../entities/image/types.ts";
import { applyImagesBatch, type ImagesBatchEvent } from "./imagesBatch.ts";
import { sortPhotos, type GallerySort, type SortKey } from "./galleryOrder.ts";

export type StreamListing = {
  /** Files seen in names/stats batches. Not necessarily the published order. */
  discovered: ImageFile[];
  /** True after browse_directory (or an equivalent full rescan) returns. */
  complete: boolean;
};

export function emptyStreamListing(): StreamListing {
  return { discovered: [], complete: false };
}

export function effectiveSortKey(sort: GallerySort): SortKey {
  if (sort.key === null) {
    return sort.grouped ? "date" : "name";
  }
  return sort.key;
}

export function listingHasDates(files: readonly ImageFile[]): boolean {
  if (files.length === 0) {
    return false;
  }
  for (const file of files) {
    if (file.modifiedAt <= 0) {
      return false;
    }
  }
  return true;
}

/** Date order needs mtimes. Name order still needs the full name list (`complete`). */
export function listingReadyForSort(listing: StreamListing, sort: GallerySort): boolean {
  if (!listing.complete || listing.discovered.length === 0) {
    return false;
  }
  if (effectiveSortKey(sort) === "date") {
    return listingHasDates(listing.discovered);
  }
  return true;
}

export function applyStreamBatch(listing: StreamListing, payload: ImagesBatchEvent): StreamListing {
  if (listing.complete) {
    return listing;
  }
  const current = asView(listing.discovered, payload.folder);
  const next = applyImagesBatch(current, payload);
  if (next.images === current.images) {
    return listing;
  }
  return { discovered: next.images, complete: false };
}

export function finishListing(files: readonly ImageFile[]): StreamListing {
  return { discovered: files.slice(), complete: true };
}

export function publishedListing(listing: StreamListing, sort: GallerySort): ImageFile[] {
  if (!listingReadyForSort(listing, sort)) {
    return [];
  }
  return sortPhotos(listing.discovered, sort);
}

export function listingStamp(files: readonly ImageFile[], sort: GallerySort): string {
  let hash = files.length | 0;
  for (let index = 0; index < files.length; index += 1) {
    const path = files[index].path;
    hash = Math.imul(hash, 33) + path.length;
    for (let offset = 0; offset < path.length; offset += 1) {
      hash = Math.imul(hash, 33) + path.charCodeAt(offset);
    }
    hash = Math.imul(hash, 33) + (files[index].size | 0);
    hash = Math.imul(hash, 33) + (files[index].modifiedAt | 0);
  }
  return `${sort.key}:${sort.direction}:${sort.grouped}:${hash}`;
}

function asView(images: ImageFile[], folder: string): DirectoryView {
  return {
    title: "",
    path: folder,
    parent: null,
    folders: [],
    images,
    serviceRole: null,
  };
}
