import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MassTrashUnfavoriteCounts } from "../../../features/selection/lib/removeFavoritesBatch";
import { useAnimatedModal } from "../../../shared/ui/useAnimatedModal";
import styles from "./FavoriteTrashUnfavoriteDialog.module.scss";

export type FavoriteTrashUnfavoriteDialogProps = {
  open: boolean;
  /** Blocks destructive actions during an in-flight single-file IPC call. */
  busy?: boolean;
  variant?: "single" | "batch";
  batchCounts?: MassTrashUnfavoriteCounts | null;
  onCancel: () => void;
  onRemoveCopy: () => void;
  onRestoreOrigin: () => void;
};
type PendingAction = "remove" | "restore" | null;

export function FavoriteTrashUnfavoriteDialog({
  open,
  busy = false,
  variant = "single",
  batchCounts = null,
  onCancel,
  onRemoveCopy,
  onRestoreOrigin,
}: FavoriteTrashUnfavoriteDialogProps) {
  const { t } = useTranslation();
  const { mounted, phase } = useAnimatedModal(open);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const choiceBusy = pendingAction !== null;
  const primaryDisabled = busy || choiceBusy;

  useEffect(() => {
    if (!open) {
      setPendingAction(null);
      return;
    }
    cancelRef.current?.focus({ preventScroll: true, focusVisible: false });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (choiceBusy && !busy) {
        setPendingAction(null);
      }
      onCancel();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel, choiceBusy, busy]);

  if (!mounted) {
    return null;
  }

  const loadingLabel = t("common.loading");
  const removeLabel =
    pendingAction === "remove"
      ? loadingLabel
      : t(
          variant === "batch"
            ? "selection.favoriteTrashBatchRemoveCopyLabel"
            : "selection.favoriteTrashRemoveCopyLabel",
        );
  const restoreLabel =
    pendingAction === "restore"
      ? loadingLabel
      : t(
          variant === "batch"
            ? "selection.favoriteTrashBatchRestoreOriginLabel"
            : "selection.favoriteTrashRestoreOriginLabel",
        );

  return (
    <div
      className={styles.backdrop}
      data-modal-phase={phase}
      role="presentation"
      onClick={() => {
        if (busy) {
          return;
        }
        if (choiceBusy) {
          setPendingAction(null);
        }
        onCancel();
      }}
    >
      <div
        className={styles.dialog}
        data-modal-phase={phase}
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorite-trash-unfavorite-title"
        aria-describedby="favorite-trash-unfavorite-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="favorite-trash-unfavorite-title" className={styles.title}>
          {variant === "batch"
            ? t("selection.favoriteTrashBatchTitle")
            : t("selection.favoriteTrashUnfavoriteTitle")}
        </h2>
        <p id="favorite-trash-unfavorite-body" className={styles.body}>
          {variant === "batch"
            ? t("selection.favoriteTrashBatchBody")
            : t("selection.favoriteTrashUnfavoriteBody")}
        </p>
        {variant === "batch" && batchCounts ? (
          <ul className={styles.stats} aria-label={t("selection.favoriteTrashBatchStatsLabel")}>
            <li>
              {t("selection.favoriteTrashBatchStatTotal", { count: batchCounts.total })}
            </li>
            <li>
              {t("selection.favoriteTrashBatchStatInTrash", { count: batchCounts.inTrash })}
            </li>
            {batchCounts.ready > 0 ? (
              <li>
                {t("selection.favoriteTrashBatchStatReadyRecycle", {
                  count: batchCounts.ready,
                })}
              </li>
            ) : null}
            {batchCounts.unresolved > 0 ? (
              <li>
                {t("selection.favoriteTrashBatchStatSkippedUnresolved", {
                  count: batchCounts.unresolved,
                })}
              </li>
            ) : null}
          </ul>
        ) : null}
        {variant === "batch" ? (
          <p className={styles.hint}>{t("selection.favoriteTrashBatchRestoreHint")}</p>
        ) : null}
        <div className={styles.actions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.actionButton}
            disabled={busy}
            onClick={() => {
              if (busy) {
                return;
              }
              if (choiceBusy) {
                setPendingAction(null);
              }
              onCancel();
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionNeutral}`}
            disabled={primaryDisabled}
            onClick={() => {
              if (primaryDisabled) {
                return;
              }
              setPendingAction("remove");
              onRemoveCopy();
            }}
          >
            {removeLabel}
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionPrimary}`}
            disabled={primaryDisabled}
            onClick={() => {
              if (primaryDisabled) {
                return;
              }
              setPendingAction("restore");
              onRestoreOrigin();
            }}
          >
            {restoreLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
