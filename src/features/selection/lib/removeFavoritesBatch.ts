import type { ImageFile } from "../../../entities/image/types";
import i18n from "../../../shared/i18n/i18n.ts";
import type {
  FavoriteBatchPathResult,
  FavoritesCleanupStatus,
  OperationNotice,
  RemoveFavoriteConfirmKind,
  RemoveFavoriteCopyResult,
  ServiceFolderCleanupResult,
  ServiceFolderLocation,
} from "./fileOperation.ts";
import { pathKey } from "./selection.ts";

export type UnfavoriteCleanupOutcome = {
  status: FavoritesCleanupStatus | null;
  /** Navigate when folder was removed by the app or is already gone. */
  navigateLocation: ServiceFolderLocation | null;
  /** True only when this app deleted the empty service folder. */
  appRemovedFolder: boolean;
};

export type FolderHistoryState = {
  index: number;
  entries: (string | null)[];
};

export type UnfavoriteBatchItemResult =
  | { path: string; status: "recycled" | "relocated"; result: RemoveFavoriteCopyResult }
  | { path: string; status: "restored_origin"; result: RemoveFavoriteCopyResult }
  | { path: string; status: "needs_confirm"; confirmKind: RemoveFavoriteConfirmKind }
  | { path: string; status: "failed"; message: string }
  | { path: string; status: "skipped"; reason?: string | null };

export type UnfavoritePreviewBuckets = {
  ready: ImageFile[];
  originInTrash: ImageFile[];
  otherConfirm: ImageFile[];
  previewFailed: UnfavoriteBatchItemResult[];
};

/** UI-бакеты mass unfavorite: FR-11 / standard confirm / ready (+ trash отдельно). */
export type UnfavoriteUiBuckets = {
  ready: ImageFile[];
  originInTrash: ImageFile[];
  fr11Required: ImageFile[];
  standardConfirm: ImageFile[];
  previewFailed: UnfavoriteBatchItemResult[];
};

export type MassTrashUnfavoriteCounts = {
  total: number;
  inTrash: number;
  ready: number;
  unresolved: number;
};

/** Classify batch preview using backend confirmKind (no path guessing). */
export function bucketUnfavoritePreviewTargets(
  targets: readonly ImageFile[],
  previews: readonly FavoriteBatchPathResult[],
): UnfavoritePreviewBuckets {
  const byPath = new Map(
    previews.map((entry) => [pathKey(entry.path), entry] as const),
  );
  const ready: ImageFile[] = [];
  const originInTrash: ImageFile[] = [];
  const otherConfirm: ImageFile[] = [];
  const previewFailed: UnfavoriteBatchItemResult[] = [];
  for (const file of targets) {
    const entry = byPath.get(pathKey(file.path));
    if (!entry) {
      previewFailed.push({
        path: file.path,
        status: "failed",
        message: i18n.t("selection.unfavoriteUnexpectedPreview"),
      });
      continue;
    }
    const preview = entry.result;
    if (preview.status === "ready") {
      ready.push(file);
      continue;
    }
    if (preview.status === "needs_confirm") {
      const kind = (preview.confirmKind ??
        entry.classifyDebug?.confirmKind ??
        "unknown_origin") as RemoveFavoriteConfirmKind;
      if (kind === "origin_in_local_trash") {
        originInTrash.push(file);
      } else {
        otherConfirm.push(file);
      }
      continue;
    }
    previewFailed.push({
      path: file.path,
      status: "failed",
      message: i18n.t("selection.unfavoriteUnexpectedPreview"),
    });
  }
  return { ready, originInTrash, otherConfirm, previewFailed };
}

/**
 * Confirm kinds that must use FR-11 (CL-P03), not standard recycle confirm.
 * Согласовано с Rust `classify_preview_bucket`: unknown_origin | ambiguous_origin.
 */
export function isFr11RequiredConfirmKind(kind: RemoveFavoriteConfirmKind): boolean {
  return kind === "unknown_origin" || kind === "ambiguous_origin";
}

/**
 * Split `otherConfirm` from {@link bucketUnfavoritePreviewTargets} into FR-11 vs standard.
 * DTO-hint `fr11Required` и kind unknown/ambiguous → fr11 (как BE T040).
 */
export function partitionFr11RequiredFromOtherConfirm(
  otherConfirm: readonly ImageFile[],
  previews: readonly FavoriteBatchPathResult[],
): { fr11Required: ImageFile[]; standardConfirm: ImageFile[] } {
  const byPath = new Map(
    previews.map((entry) => [pathKey(entry.path), entry] as const),
  );
  const fr11Required: ImageFile[] = [];
  const standardConfirm: ImageFile[] = [];
  for (const file of otherConfirm) {
    const entry = byPath.get(pathKey(file.path));
    const preview = entry?.result;
    const hint = (preview as { fr11Required?: boolean | null } | undefined)?.fr11Required;
    const kind = (preview?.confirmKind ??
      entry?.classifyDebug?.confirmKind ??
      "unknown_origin") as RemoveFavoriteConfirmKind;
    if (hint === true || isFr11RequiredConfirmKind(kind)) {
      fr11Required.push(file);
    } else {
      standardConfirm.push(file);
    }
  }
  return { fr11Required, standardConfirm };
}

/** T042: preview → UI-бакеты fr11Required / standardConfirm / ready (+ trash). */
export function bucketUnfavoriteUiTargets(
  targets: readonly ImageFile[],
  previews: readonly FavoriteBatchPathResult[],
): UnfavoriteUiBuckets {
  const base = bucketUnfavoritePreviewTargets(targets, previews);
  const { fr11Required, standardConfirm } = partitionFr11RequiredFromOtherConfirm(
    base.otherConfirm,
    previews,
  );
  return {
    ready: base.ready,
    originInTrash: base.originInTrash,
    fr11Required,
    standardConfirm,
    previewFailed: base.previewFailed,
  };
}

export function massTrashUnfavoriteCounts(
  total: number,
  buckets: Pick<UnfavoritePreviewBuckets, "ready" | "originInTrash" | "otherConfirm"> & {
    fr11Required?: readonly ImageFile[];
    standardConfirm?: readonly ImageFile[];
  },
): MassTrashUnfavoriteCounts {
  const unresolved =
    buckets.fr11Required !== undefined || buckets.standardConfirm !== undefined
      ? (buckets.fr11Required?.length ?? 0) + (buckets.standardConfirm?.length ?? 0)
      : buckets.otherConfirm.length;
  return {
    total,
    inTrash: buckets.originInTrash.length,
    ready: buckets.ready.length,
    unresolved,
  };
}

/** Deduplicate by pathKey and keep only files that live in the open favorites folder. */
export function prepareFavoriteRemovalTargets(
  files: readonly ImageFile[],
  favoritesDirectory: string,
): ImageFile[] {
  const folderKey = pathKey(favoritesDirectory);
  const seen = new Set<string>();
  const out: ImageFile[] = [];
  for (const file of files) {
    const key = pathKey(file.path);
    if (seen.has(key)) {
      continue;
    }
    const parent = parentDirectory(file.path);
    if (!parent || pathKey(parent) !== folderKey) {
      continue;
    }
    seen.add(key);
    out.push(file);
  }
  out.sort((left, right) => pathKey(left.path).localeCompare(pathKey(right.path)));
  return out;
}

/** Selection landing key when a background mass unfavorite starts (matches GalleryPage). */
export function massUnfavoriteStartLandingKey(options: {
  currentPath: string | null;
  sessionPath: string;
  parentDirectory: string | null;
}): string {
  const onFavorites =
    options.currentPath !== null &&
    pathKey(options.currentPath) === pathKey(options.sessionPath);
  return pathKey(
    onFavorites && options.parentDirectory
      ? options.parentDirectory
      : (options.currentPath ?? options.sessionPath),
  );
}

/** Selection landing key when a background mass unfavorite finishes (matches GalleryPage). */
/** Only reset selection on finish while the user is still inside the favorites folder session. */
export function shouldApplyMassUnfavoriteSelectionReset(options: {
  currentPath: string | null;
  sessionPath: string;
}): boolean {
  if (!options.currentPath) {
    return false;
  }
  return pathKey(options.currentPath) === pathKey(options.sessionPath);
}

export function massUnfavoriteFinishLandingKey(options: {
  currentPath: string | null;
  sessionPath: string;
  parentDirectory: string | null;
  navigateLocation: ServiceFolderLocation | null;
}): string | null {
  const currentKey = options.currentPath ? pathKey(options.currentPath) : null;
  if (options.navigateLocation != null) {
    return pathKey(options.navigateLocation.parentDirectory);
  }
  if (options.parentDirectory && currentKey === pathKey(options.sessionPath)) {
    return pathKey(options.parentDirectory);
  }
  return currentKey;
}

export function basenameFromPath(path: string): string {
  const normalized = path.replace(/\//g, "\\").replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export type BatchUnfavoriteConfirmLine = {
  basename: string;
  kind: RemoveFavoriteConfirmKind;
  label: string;
};

export function unfavoriteConfirmKindLabel(kind: RemoveFavoriteConfirmKind): string {
  switch (kind) {
    case "unknown_origin":
      return i18n.t("selection.favoriteConfirmUnknownOrigin");
    case "copy_changed":
      return i18n.t("selection.favoriteConfirmCopyChanged");
    case "origin_changed":
      return i18n.t("selection.favoriteConfirmOriginChanged");
    case "ambiguous_origin":
      return i18n.t("selection.favoriteConfirmAmbiguousOrigin");
    case "origin_in_local_trash":
      return i18n.t("selection.favoriteConfirmOriginInTrash");
    default:
      return i18n.t("selection.favoriteConfirmUnknownOrigin");
  }
}

export function batchUnfavoriteConfirmLines(
  files: readonly { path: string }[],
  previews: readonly FavoriteBatchPathResult[],
): BatchUnfavoriteConfirmLine[] {
  const byPath = new Map(
    previews.map((entry) => [pathKey(entry.path), entry] as const),
  );
  const lines: BatchUnfavoriteConfirmLine[] = [];
  for (const file of files) {
    const preview = byPath.get(pathKey(file.path));
    if (!preview || preview.result.status !== "needs_confirm") {
      continue;
    }
    const kind = (preview.result.confirmKind ??
      preview.classifyDebug?.confirmKind ??
      "unknown_origin") as RemoveFavoriteConfirmKind;
    lines.push({
      basename: preview.classifyDebug?.basename ?? basenameFromPath(file.path),
      kind,
      label: unfavoriteConfirmKindLabel(kind),
    });
  }
  return lines;
}

export function parentDirectory(path: string): string | null {
  const sep = path.startsWith("/") ? "/" : "\\";
  const normalized = path.replace(/[\\/]/g, sep).replace(/[\\/]+$/, "");
  const index = normalized.lastIndexOf(sep);
  if (index <= 0) {
    return null;
  }
  if (normalized.startsWith("\\\\") && index <= 1) {
    return null;
  }
  return normalized.slice(0, index);
}

export function unfavoriteProgressLabel(processed: number, total: number): string {
  return i18n.t("selection.unfavoriteProgress", { processed, total });
}

export function batchUnfavoritePromptCopy(count: number): { text: string; confirmLabel: string } {
  return {
    text: `${i18n.t("selection.favoriteBatchConfirmTitle")}\n\n${i18n.t("selection.favoriteBatchConfirmBody", { count })}`,
    confirmLabel: i18n.t("selection.favoriteSaveCopyLabel"),
  };
}

export function summarizeUnfavoriteBatch(options: {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cleanup: UnfavoriteCleanupOutcome;
  errors: readonly string[];
}): OperationNotice {
  const { total, succeeded, failed, skipped, cleanup, errors } = options;
  const unresolved = failed + skipped;
  const details = uniqueMessages(errors).slice(0, 5);
  if (errors.length > 5) {
    details.push(i18n.t("selection.noticeAndMore", { count: errors.length - 5 }));
  }

  if (cleanup.status === "failed" && succeeded > 0) {
    return {
      tone: "partial",
      text: i18n.t("selection.unfavoriteCleanupFailed"),
      details,
    };
  }

  if (cleanup.status === "not_empty" && succeeded > 0 && unresolved === 0) {
    return {
      tone: "ok",
      text: `${i18n.t("selection.unfavoriteRemovedCount", { count: succeeded })}. ${i18n.t("selection.unfavoriteFolderKeptOtherFiles")}`,
      details: [],
    };
  }

  if (cleanup.appRemovedFolder && succeeded > 0 && unresolved === 0) {
    return {
      tone: "ok",
      text: i18n.t("selection.unfavoriteAllRemovedFolderDeleted"),
      details: [],
    };
  }

  if (succeeded > 0 && unresolved === 0) {
    return {
      tone: "ok",
      text: i18n.t("selection.unfavoriteRemovedCount", { count: succeeded }),
      details: [],
    };
  }

  if (succeeded > 0 && unresolved > 0) {
    return {
      tone: "partial",
      text: i18n.t("selection.unfavoritePartial", { done: succeeded, total, failed: unresolved }),
      details,
    };
  }

  if (failed > 0) {
    return {
      tone: "failed",
      text: i18n.t("selection.unfavoritePartial", { done: 0, total, failed: unresolved }),
      details,
    };
  }

  return {
    tone: "cancelled",
    text: i18n.t("selection.unfavoritePartial", { done: 0, total, failed: unresolved }),
    details,
  };
}

export function mergeCleanupOutcomes(
  fromResults: UnfavoriteCleanupOutcome,
  fallback: ServiceFolderCleanupResult | null,
): UnfavoriteCleanupOutcome {
  if (fromResults.navigateLocation || fromResults.status === "not_empty" || fromResults.status === "failed") {
    return fromResults;
  }
  if (!fallback) {
    return fromResults;
  }
  return cleanupOutcomeFromStatus(fallback.status, fallback.location ?? null);
}

export function cleanupOutcomeFromStatus(
  status: FavoritesCleanupStatus | null | undefined,
  location: ServiceFolderLocation | null,
): UnfavoriteCleanupOutcome {
  if (!status) {
    // Legacy / partial payloads: a location alone means the folder is gone for navigation.
    if (location) {
      return { status: "removed", navigateLocation: location, appRemovedFolder: true };
    }
    return { status: null, navigateLocation: null, appRemovedFolder: false };
  }
  if (status === "removed") {
    return { status, navigateLocation: location, appRemovedFolder: true };
  }
  if (status === "already_gone") {
    return { status, navigateLocation: location, appRemovedFolder: false };
  }
  return { status, navigateLocation: null, appRemovedFolder: false };
}

function uniqueMessages(messages: readonly string[]): string[] {
  const unique: string[] = [];
  for (const message of messages) {
    const trimmed = message.trim();
    if (!trimmed || unique.includes(trimmed)) {
      continue;
    }
    unique.push(trimmed);
  }
  return unique;
}

export function interpretRemovalOutcome(
  path: string,
  result: RemoveFavoriteCopyResult,
): UnfavoriteBatchItemResult {
  if (result.status === "needs_confirm") {
    return {
      path,
      status: "needs_confirm",
      confirmKind: result.confirmKind ?? "unknown_origin",
    };
  }
  if (result.status === "skipped") {
    return { path, status: "skipped", reason: result.noticeCode ?? null };
  }
  if (result.status === "failed") {
    return {
      path,
      status: "failed",
      message: result.noticeCode ?? i18n.t("selection.unfavoriteUnexpectedResponse"),
    };
  }
  if (result.status === "ready") {
    return { path, status: "failed", message: i18n.t("selection.unfavoriteUnexpectedPreview") };
  }
  if (result.status === "restored_origin") {
    return { path, status: "restored_origin", result };
  }
  if (result.status === "recycled" || result.status === "relocated") {
    return { path, status: result.status, result };
  }
  return { path, status: "failed", message: i18n.t("selection.unfavoriteUnexpectedResponse") };
}

export function summarizeUnfavoriteBatchDetailed(options: {
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  restored: number;
  needsReconciliation: number;
}): OperationNotice {
  const parts = [
    i18n.t("selection.unfavoriteBatchSummaryProcessed", { count: options.processed }),
    i18n.t("selection.unfavoriteBatchSummarySkipped", { count: options.skipped }),
    i18n.t("selection.unfavoriteBatchSummaryFailed", { count: options.failed }),
  ];
  if (options.restored > 0) {
    parts.push(i18n.t("selection.unfavoriteBatchSummaryRestored", { count: options.restored }));
  }
  if (options.needsReconciliation > 0) {
    parts.push(
      i18n.t("selection.unfavoriteBatchSummaryReconcile", {
        count: options.needsReconciliation,
      }),
    );
  }
  const text = parts.join(" ");
  if (options.failed > 0 || options.needsReconciliation > 0) {
    return { tone: "partial", text, details: [] };
  }
  if (options.succeeded === 0 && options.restored === 0) {
    return { tone: "cancelled", text, details: [] };
  }
  return { tone: "ok", text, details: [] };
}

/** Drop deleted service-folder entries from back/forward history and point at the parent. */
export function historyWithoutRemovedFolder(
  history: FolderHistoryState,
  removedFolderPath: string,
  parentDirectoryPath: string,
): FolderHistoryState {
  const removedKey = pathKey(removedFolderPath);
  const parentKey = pathKey(parentDirectoryPath);
  const wasOnRemoved =
    history.entries[history.index] != null && pathKey(history.entries[history.index]!) === removedKey;

  const withoutRemoved = history.entries.filter(
    (entry) => entry === null || pathKey(entry) !== removedKey,
  );
  const entries = collapseConsecutive(withoutRemoved);
  if (entries.length === 0) {
    entries.push(parentDirectoryPath);
  }

  if (wasOnRemoved) {
    let index = lastIndexMatching(entries, parentKey);
    if (index < 0) {
      entries.push(parentDirectoryPath);
      index = entries.length - 1;
    }
    return { index, entries };
  }

  const removedBeforeCurrent = history.entries
    .slice(0, history.index + 1)
    .filter((entry) => entry !== null && pathKey(entry) === removedKey).length;
  const index = Math.max(0, Math.min(entries.length - 1, history.index - removedBeforeCurrent));
  return { index, entries };
}

function collapseConsecutive(entries: readonly (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (const entry of entries) {
    const prev = out[out.length - 1];
    if (prev === undefined) {
      out.push(entry);
      continue;
    }
    if (prev === null && entry === null) {
      continue;
    }
    if (prev !== null && entry !== null && pathKey(prev) === pathKey(entry)) {
      continue;
    }
    out.push(entry);
  }
  return out;
}

function lastIndexMatching(entries: readonly (string | null)[], key: string): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== null && pathKey(entry) === key) {
      return index;
    }
  }
  return -1;
}

export function pickRemovedServiceFolder(
  results: readonly UnfavoriteBatchItemResult[],
): ServiceFolderLocation | null {
  return pickCleanupFromResults(results).navigateLocation;
}

/** Prefer the last non-null cleanup status from successful file ops. */
export function pickCleanupFromResults(
  results: readonly UnfavoriteBatchItemResult[],
): UnfavoriteCleanupOutcome {
  let status: FavoritesCleanupStatus | null = null;
  let location: ServiceFolderLocation | null = null;
  for (const item of results) {
    if (item.status !== "recycled" && item.status !== "relocated") {
      continue;
    }
    if (item.result.cleanupStatus) {
      status = item.result.cleanupStatus;
    }
    if (item.result.removedServiceFolder) {
      location = item.result.removedServiceFolder;
    }
  }
  return cleanupOutcomeFromStatus(status, location);
}

export function successfulRemovalKeys(results: readonly UnfavoriteBatchItemResult[]): Set<string> {
  const keys = new Set<string>();
  for (const item of results) {
    if (item.status === "recycled" || item.status === "relocated") {
      keys.add(pathKey(item.path));
    }
  }
  return keys;
}
