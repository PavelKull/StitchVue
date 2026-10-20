import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedModalFrame } from "../../../shared/ui/AnimatedModalFrame";
import type { MockUpdatePhase } from "../model/mockUpdateFlow";
import styles from "./UpdateDialog.module.scss";

export type UpdateDialogProps = {
  open: boolean;
  installedVersion: string;
  availableVersion: string;
  releaseNotes: string;
  phase: MockUpdatePhase;
  progress: number;
  operationsBlocked: boolean;
  onLater: () => void;
  onUpdate: () => void;
  onRetry: () => void;
  onCloseReady: () => void;
  onPreviewError?: () => void;
};

export function UpdateDialog({
  open,
  installedVersion,
  availableVersion,
  releaseNotes,
  phase,
  progress,
  operationsBlocked,
  onLater,
  onUpdate,
  onRetry,
  onCloseReady,
  onPreviewError,
}: UpdateDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const laterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    laterRef.current?.focus({ preventScroll: true, focusVisible: false });
  }, [open, phase]);

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
      if (phase === "downloading") {
        return;
      }
      onLater();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onLater, phase]);

  const updateDisabled = operationsBlocked || phase === "downloading";

  return (
    <AnimatedModalFrame
      open={open}
      titleId={titleId}
      onBackdropClick={() => {
        if (phase === "downloading") {
          return;
        }
        onLater();
      }}
    >
      <p className={styles.mockBadge}>{t("appUpdate.mockBadge")}</p>
      <h2 id={titleId} className={styles.title}>{t("appUpdate.title")}</h2>
      <p className={styles.meta}>
        {t("appUpdate.versionLine", {
          current: installedVersion,
          next: availableVersion,
        })}
      </p>
      {phase === "prompt" || phase === "downloading" ? (
        <div className={styles.notes}>{releaseNotes}</div>
      ) : null}
      {operationsBlocked && phase === "prompt" ? (
        <p className={styles.hint}>{t("appUpdate.blockedHint")}</p>
      ) : null}
      {phase === "error" ? (
        <p className={styles.error}>{t("appUpdate.networkError")}</p>
      ) : null}
      {phase === "ready" ? (
        <p className={styles.hint}>{t("appUpdate.readyMock")}</p>
      ) : null}
      {phase === "downloading" ? (
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className={styles.progressBar} style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div className={styles.actions}>
        {phase === "prompt" ? (
          <>
            {import.meta.env.DEV && onPreviewError ? (
              <button type="button" className={styles.ghost} onClick={onPreviewError}>
                {t("appUpdate.previewErrorDev")}
              </button>
            ) : null}
            <button ref={laterRef} type="button" className={styles.secondary} onClick={onLater}>
              {t("appUpdate.later")}
            </button>
            <button type="button" className={styles.primary} disabled={updateDisabled} onClick={onUpdate}>
              {t("appUpdate.update")}
            </button>
          </>
        ) : null}
        {phase === "downloading" ? (
          <button type="button" className={styles.secondary} disabled>
            {t("appUpdate.downloading", { percent: progress })}
          </button>
        ) : null}
        {phase === "error" ? (
          <>
            <button type="button" className={styles.secondary} onClick={onLater}>
              {t("appUpdate.later")}
            </button>
            <button type="button" className={styles.primary} disabled={operationsBlocked} onClick={onRetry}>
              {t("appUpdate.retry")}
            </button>
          </>
        ) : null}
        {phase === "ready" ? (
          <button type="button" className={styles.primary} onClick={onCloseReady}>
            {t("appUpdate.close")}
          </button>
        ) : null}
      </div>
    </AnimatedModalFrame>
  );
}
