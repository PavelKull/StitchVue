import type { FolderShortcut } from "../../../../entities/folder/types";
import type { ImageFile, ImageMeta, ThumbInfo } from "../../../../entities/image/types";
import type { LayoutMode } from "../../../../entities/gallery/layoutMode";
import type { GallerySort } from "../listing/galleryOrder";

function pathKey(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export const HOT_FOLDER_LIMIT = 5;
export const HOT_BYTE_LIMIT = 64 * 1024 * 1024;

export type HotFolder = {
  path: string;
  title: string;
  parent: string | null;
  folders: FolderShortcut[];
  images: ImageFile[];
  sort: GallerySort;
  layoutMode: LayoutMode;
  rowsPerScreen: number;
  scrollTop: number;
  meta: [string, ImageMeta][];
  thumbs: [string, ThumbInfo][];
  bytes: number;
};

const entries = new Map<string, HotFolder>();
const recent: string[] = [];

export function hotCacheSnapshot(): { folders: number; bytes: number; paths: string[] } {
  let bytes = 0;
  for (const entry of entries.values()) {
    bytes += entry.bytes;
  }
  return { folders: entries.size, bytes, paths: [...recent] };
}

export function recallHotFolder(path: string): HotFolder | null {
  const key = pathKey(path);
  const entry = entries.get(key);
  if (!entry) {
    return null;
  }
  touch(key);
  return entry;
}

/** Drop one folder snapshot after its on-disk listing changed (e.g. trash move). */
export function forgetHotFolder(path: string): void {
  const key = pathKey(path);
  if (!entries.delete(key)) {
    return;
  }
  const index = recent.indexOf(key);
  if (index >= 0) {
    recent.splice(index, 1);
  }
}

export function rememberHotFolder(entry: Omit<HotFolder, "bytes">): void {
  const key = pathKey(entry.path);
  const stored: HotFolder = { ...entry, bytes: estimate(entry) };
  entries.set(key, stored);
  touch(key);
  evict(key);
}

export function resetHotCache(): void {
  entries.clear();
  recent.length = 0;
}

function touch(key: string) {
  const index = recent.indexOf(key);
  if (index >= 0) {
    recent.splice(index, 1);
  }
  recent.push(key);
}

function evict(activeKey: string) {
  while (recent.length > HOT_FOLDER_LIMIT || totalBytes() > HOT_BYTE_LIMIT) {
    const oldest = recent.find((key) => key !== activeKey);
    if (!oldest) {
      break;
    }
    recent.splice(recent.indexOf(oldest), 1);
    entries.delete(oldest);
  }
}

function totalBytes(): number {
  let bytes = 0;
  for (const entry of entries.values()) {
    bytes += entry.bytes;
  }
  return bytes;
}

function estimate(entry: Omit<HotFolder, "bytes">): number {
  let bytes = 256 + entry.title.length * 2;
  for (const file of entry.images) {
    bytes += file.path.length * 2 + file.name.length * 2 + 24;
  }
  for (const folder of entry.folders) {
    bytes += folder.path.length * 2 + folder.name.length * 2 + 16;
  }
  bytes += entry.meta.length * 48;
  bytes += entry.thumbs.length * 96;
  return bytes;
}

export function retainUnchanged(
  previous: readonly ImageFile[],
  next: readonly ImageFile[],
  meta: Map<string, ImageMeta>,
  thumbs: Map<string, ThumbInfo>,
  failed: Map<string, string>,
) {
  const before = new Map(previous.map((file) => [file.path, file]));
  const keep = new Set<string>();
  for (const file of next) {
    const old = before.get(file.path);
    if (old && old.size === file.size && old.modifiedAt === file.modifiedAt && file.size > 0) {
      keep.add(file.path);
    }
  }
  for (const path of [...meta.keys()]) {
    if (!keep.has(path)) {
      meta.delete(path);
    }
  }
  for (const path of [...thumbs.keys()]) {
    if (!keep.has(path)) {
      thumbs.delete(path);
    }
  }
  for (const path of [...failed.keys()]) {
    if (!keep.has(path)) {
      failed.delete(path);
    }
  }
}
