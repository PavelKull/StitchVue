import type { ImageMeta } from "../../entities/image/types";

export type DeferredVoid = {
  promise: Promise<void>;
  resolve: () => void;
};

/** One-shot gate so bootstrap can wait until Tauri `listen()` subscriptions are live. */
export function createDeferredVoid(): DeferredVoid {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** True when mosaic/columns can publish at least one trusted tile aspect. */
export function listingHasTrustedGeometry(
  images: readonly { path: string }[],
  meta: Map<string, ImageMeta>,
  failed: Map<string, string>,
): boolean {
  for (const file of images) {
    if (failed.has(file.path)) {
      return true;
    }
    const known = meta.get(file.path);
    if (known && known.height > 0) {
      return true;
    }
  }
  return false;
}
