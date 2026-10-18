import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnimatedModal } from "../../../shared/ui/useAnimatedModal";
import styles from "./FavoriteMissingOriginDialog.module.scss";

/** FR-11 resolution strings (P4a backend contract). */
export type Fr11Resolution =
  | "return_to_source"
  | "choose_folder"
  | "keep_copy"
  | "recycle_copy";

export type FavoriteMissingOriginDialogProps = {
  open: boolean;
  /** Блокирует действия во время in-flight IPC. */
  busy?: boolean;
  /** D: recycle последней копии; false — скрыть (N/A). */
  showRecycle?: boolean;
  onCancel: () => void;
  onReturnToSource: () => void;
  /** Может открыть folder picker; при отмене пикера диалог остаётся открытым. */
  onChooseFolder: () => void | Promise<void>;
  onKeepCopy: () => void;
  onRecycleCopy?: () => void;
};

type PendingAction = Fr11Resolution | null;

export function FavoriteMissingOriginDialog({
  open,
  busy = false,
  showRecycle = true,
  onCancel,
  onReturnToSource,
  onChooseFolder,
  onKeepCopy,
  onRecycleCopy,
}: FavoriteMissingOriginDialogProps) {
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
        aria-labelledby="favorite-missing-origin-title"
        aria-describedby="favorite-missing-origin-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="favorite-missing-origin-title" className={styles.title}>
          {t("selection.favoriteMissingOriginTitle")}
        </h2>
        <p id="favorite-missing-origin-body" className={styles.body}>
          {t("selection.favoriteMissingOriginBody")}
        </p>
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
            className={`${styles.actionButton} ${styles.actionPrimary}`}
            disabled={primaryDisabled}
            onClick={() => {
              if (primaryDisabled) {
                return;
              }
              setPendingAction("return_to_source");
              onReturnToSource();
            }}
          >
            {pendingAction === "return_to_source"
              ? loadingLabel
              : t("selection.favoriteMissingOriginReturnLabel")}
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionNeutral}`}
            disabled={primaryDisabled}
            onClick={() => {
              if (primaryDisabled) {
                return;
              }
              setPendingAction("choose_folder");
              void Promise.resolve(onChooseFolder()).finally(() => {
                // Пикер отменён — снять локальный busy; при успехе open станет false.
                setPendingAction((current) =>
                  current === "choose_folder" ? null : current,
                );
              });
            }}
          >
            {pendingAction === "choose_folder"
              ? loadingLabel
              : t("selection.favoriteMissingOriginChooseFolderLabel")}
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionNeutral}`}
            disabled={primaryDisabled}
            onClick={() => {
              if (primaryDisabled) {
                return;
              }
              setPendingAction("keep_copy");
              onKeepCopy();
            }}
          >
            {pendingAction === "keep_copy"
              ? loadingLabel
              : t("selection.favoriteMissingOriginKeepCopyLabel")}
          </button>
          {showRecycle && onRecycleCopy ? (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionDanger}`}
              disabled={primaryDisabled}
              onClick={() => {
                if (primaryDisabled) {
                  return;
                }
                setPendingAction("recycle_copy");
                onRecycleCopy();
              }}
            >
              {pendingAction === "recycle_copy"
                ? loadingLabel
                : t("selection.favoriteMissingOriginRecycleLabel")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
