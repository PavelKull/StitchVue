import type { FavoriteBatchPathResult } from "./fileOperation.ts";
import { basenameFromPath } from "./removeFavoritesBatch.ts";

/** DEV-only: log sanitized batch preview diagnostics (no full paths or hashes). */
export function unfavoriteClassifyDiagEnabled(): boolean {
  return import.meta.env.DEV === true;
}

export function logUnfavoriteBatchClassifyDebug(previews: readonly FavoriteBatchPathResult[]): void {
  if (!unfavoriteClassifyDiagEnabled()) {
    return;
  }
  for (const entry of previews) {
    if (entry.result.status !== "needs_confirm") {
      continue;
    }
    const debug = entry.classifyDebug;
    const kind = entry.result.confirmKind ?? debug?.confirmKind ?? "unknown_origin";
    console.info("[unfavorite-preview]", {
      basename: debug?.basename ?? basenameFromPath(entry.path),
      confirmKind: kind,
      snapshotPresent: debug?.snapshotPresent ?? null,
      recordVersion: debug?.recordVersion ?? null,
      reasonCode: debug?.reasonCode ?? null,
      copyCheck: debug?.copyCheck ?? null,
      originCheck: debug?.originCheck ?? null,
    });
  }
}
