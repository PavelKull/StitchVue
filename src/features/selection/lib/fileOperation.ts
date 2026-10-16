import { formatOutcomeError } from "../../../shared/i18n/errors.ts";
import { formatFileSize } from "../../../shared/i18n/formatters.ts";
import i18n from "../../../shared/i18n/i18n.ts";

export type FileAction = "move_to_local_trash" | "copy_to_local_favorites";

export type FileOutcome = {
  sourcePath: string;
  status: "moved" | "copied" | "already_exists" | "failed" | "cancelled";
  destinationPath?: string;
  renamedDueToCollision?: boolean;
  errorCode?: string;
  errorMessage?: string;
  attributeNote?: string;
};

export type FileOperationResult = {
  operationId: string;
  directory: string;
  action: string;
  state: string;
  requested: number;
  outcomes: FileOutcome[];
  destinationFolder?: string | null;
  destinationCreated?: boolean;
  destinationRole?: "favorites" | "trash" | null;
};

export type ServiceFolderLocation = {
  parentDirectory: string;
  folderPath: string;
};

export type RemoveFavoriteConfirmKind =
  | "unknown_origin"
  | "origin_changed"
  | "copy_changed"
  | "ambiguous_origin";

export type FavoritesCleanupStatus = "removed" | "not_empty" | "already_gone" | "failed";

export type RemoveFavoriteCopyResult = {
  status: "recycled" | "relocated" | "needs_confirm" | "ready";
  undoId: string;
  removedServiceFolder?: ServiceFolderLocation | null;
  restoredPath?: string | null;
  noticeCode?: string | null;
  confirmKind?: RemoveFavoriteConfirmKind | null;
  cleanupStatus?: FavoritesCleanupStatus | null;
};

export type RemovalClassifyDebug = {
  basename: string;
  confirmKind?: string | null;
  snapshotPresent: boolean;
  recordVersion?: number | null;
  reasonCode: string;
  copyCheck: string;
  originCheck: string;
};

export type FavoriteBatchPathResult = {
  path: string;
  result: RemoveFavoriteCopyResult;
  classifyDebug?: RemovalClassifyDebug | null;
};

export type FavoriteCopyOrigin = {
  copyPath: string;
  originPath: string | null;
};

export type ServiceFolderCleanupResult = {
  status: FavoritesCleanupStatus;
  location?: ServiceFolderLocation | null;
  message?: string | null;
};

export type RestoreTrashResult = {
  restoredPath: string;
  removedServiceFolder?: ServiceFolderLocation | null;
};

export type RecycleItemResult = {
  path: string;
  status: string;
  removedServiceFolder?: ServiceFolderLocation | null;
};

export type FileOperationProgress = {
  operationId: string;
  directory: string;
  state: string;
  phase: string;
  processed: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
};

export type OperationSummary = {
  moved: number;
  copied: number;
  alreadyExists: number;
  failed: number;
  cancelled: number;
  renamed: number;
  errors: string[];
};

export type OperationNotice = {
  tone: "ok" | "partial" | "failed" | "cancelled";
  title?: string;
  text: string;
  details: string[];
  undoIds?: string[];
};

export type MoveConfirm = "always" | "mass" | "never";

const CONFIRM_AFTER = 20;

export function summarize(outcomes: FileOutcome[]): OperationSummary {
  const summary: OperationSummary = {
    moved: 0,
    copied: 0,
    alreadyExists: 0,
    failed: 0,
    cancelled: 0,
    renamed: 0,
    errors: [],
  };
  for (const outcome of outcomes) {
    if (outcome.status === "moved") summary.moved += 1;
    else if (outcome.status === "copied") summary.copied += 1;
    else if (outcome.status === "already_exists") summary.alreadyExists += 1;
    else if (outcome.status === "cancelled") summary.cancelled += 1;
    else summary.failed += 1;
    if (outcome.renamedDueToCollision) summary.renamed += 1;
    if (outcome.status === "failed") {
      summary.errors.push(formatOutcomeError(outcome));
    }
  }
  return summary;
}

export function operationNotice(action: FileAction, summary: OperationSummary): OperationNotice {
  const moved = action === "move_to_local_trash";
  const success = moved ? summary.moved : summary.copied;
  const parts = [
    i18n.t(moved ? "selection.noticeMoved" : "selection.noticeCopied", { count: success }),
  ];
  if (!moved && summary.alreadyExists > 0) {
    parts.push(i18n.t("selection.noticeAlreadyExists", { count: summary.alreadyExists }));
  }
  if (summary.renamed > 0) parts.push(i18n.t("selection.noticeRenamed", { count: summary.renamed }));
  if (summary.failed > 0) parts.push(i18n.t("selection.noticeFailed", { count: summary.failed }));
  if (summary.cancelled > 0) parts.push(i18n.t("selection.noticeCancelled", { count: summary.cancelled }));
  const anySuccess = success > 0 || summary.alreadyExists > 0;
  const tone: OperationNotice["tone"] =
    summary.failed > 0 ? (anySuccess ? "partial" : "failed") : summary.cancelled > 0 && !anySuccess ? "cancelled" : "ok";
  const details = summary.errors.slice(0, 5);
  if (summary.errors.length > 5) {
    details.push(i18n.t("selection.noticeAndMore", { count: summary.errors.length - 5 }));
  }
  return { tone, text: parts.join(" · "), details };
}

export function needsMoveConfirm(count: number, mode: MoveConfirm): boolean {
  if (mode === "never" || count < 1) return false;
  if (mode === "always") return true;
  return count > CONFIRM_AFTER;
}

export function confirmMoveText(count: number): string {
  return i18n.t("selection.moveConfirm", { count });
}

export type CommandAvailability = {
  deleteReason: string | null;
  favoriteReason: string | null;
  restoreReason: string | null;
};

export function commandAvailability(options: {
  hasDirectory: boolean;
  role: "favorites" | "trash" | null;
  running: boolean;
  targetCount: number;
}): CommandAvailability {
  const idle = !options.hasDirectory || options.targetCount === 0 ? i18n.t("selection.noSelection") : null;
  const running = options.running ? i18n.t("selection.operationRunning") : null;
  const blocked = idle ?? running;
  if (options.role === "trash") {
    return {
      deleteReason: i18n.t("selection.deletePermanentUnavailable"),
      favoriteReason: i18n.t("selection.favoriteUnavailableInTrash"),
      restoreReason: blocked,
    };
  }
  if (options.role === "favorites") {
    return {
      deleteReason: blocked,
      favoriteReason: blocked,
      restoreReason: i18n.t("selection.restoreOnlyInTrash"),
    };
  }
  return {
    deleteReason: blocked,
    favoriteReason: blocked,
    restoreReason: i18n.t("selection.restoreOnlyInTrash"),
  };
}

export function progressLabel(progress: FileOperationProgress | null): string | null {
  if (!progress) return null;
  const phase =
    progress.phase === "checking_duplicates"
      ? i18n.t("selection.phaseCheckingDuplicates")
      : progress.phase === "copying"
        ? i18n.t("selection.phaseCopying")
        : progress.phase === "moving"
          ? i18n.t("selection.phaseMoving")
          : i18n.t("selection.phaseProcessing");
  const count = i18n.t("selection.progressCount", {
    phase,
    processed: progress.processed,
    total: progress.total,
  });
  if (progress.bytesTotal > 0 && progress.phase === "copying") {
    return i18n.t("selection.progressBytes", {
      count,
      done: formatBytes(progress.bytesDone),
      total: formatBytes(progress.bytesTotal),
    });
  }
  return count;
}

function formatBytes(bytes: number): string {
  return formatFileSize(bytes);
}

export function operationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
