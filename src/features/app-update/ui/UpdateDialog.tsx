import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedModalFrame } from "../../../shared/ui/AnimatedModalFrame";
import type { UpdateErrorKey, UpdatePhase } from "../lib/updateLifecycle";
import styles from "./UpdateDialog.module.scss";

export type UpdateDialogProps = {
  open: boolean;
  installedVersion: string;
  availableVersion: string;
  releaseNotes: string;
  phase: UpdatePhase;
  progress: number;
  errorKey: UpdateErrorKey | null;
  operationsBlocked: boolean;
  onLater: () => void;
  onUpdate: () => void;
  onRetry: () => void;
  onClose: () => void;
};

export function UpdateDialog({
  open,
  installedVersion,
  availableVersion,
  releaseNotes,
  phase,
  progress,
  errorKey,
  operationsBlocked,
  onLater,
  onUpdate,
  onRetry,
  onClose,
}: UpdateDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const laterRef = useRef<HTMLButtonElement>(null);

  const busyPhase = phase === "arming" || phase === "downloading" || phase === "installing";

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
      if (busyPhase) {
        return;
      }
      onLater();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onLater, busyPhase]);

  const updateDisabled = operationsBlocked || busyPhase || phase === "checking";
  const title =
    phase === "upToDate"
      ? t("appUpdate.upToDateTitle")
      : phase === "checking"
        ? t("appUpdate.checking")
        : t("appUpdate.title");

  const errorText =
    errorKey === "blocked"
      ? t("appUpdate.blockedHint")
      : errorKey === "prepare"
        ? t("appUpdate.prepareError")
        : errorKey === "signature"
          ? t("appUpdate.signatureError")
          : errorKey === "install"
            ? t("appUpdate.installError")
            : errorKey === "network"
              ? t("appUpdate.networkError")
              : null;

  return (
    <AnimatedModalFrame
      open={open}
      titleId={titleId}
      onBackdropClick={() => {
        if (busyPhase) {
          return;
        }
        onLater();
      }}
    >
      <h2 id={titleId} className={styles.title}>{title}</h2>
      {phase !== "upToDate" && phase !== "checking" ? (
        <p className={styles.meta}>
          {t("appUpdate.versionLine", {
            current: installedVersion,
            next: availableVersion || "—",
          })}
        </p>
      ) : null}
      {phase === "upToDate" ? (
        <p className={styles.meta}>{t("appUpdate.upToDateBody", { version: installedVersion })}</p>
      ) : null}
      {(phase === "prompt" || phase === "downloading" || phase === "arming") && releaseNotes ? (
        <div className={styles.notes}>{releaseNotes}</div>
      ) : null}
      {operationsBlocked && phase === "prompt" ? (
        <p className={styles.hint}>{t("appUpdate.blockedHint")}</p>
      ) : null}
      {phase === "error" && errorText ? <p className={styles.error}>{errorText}</p> : null}
      {phase === "arming" ? <p className={styles.hint}>{t("appUpdate.arming")}</p> : null}
      {phase === "installing" ? <p className={styles.hint}>{t("appUpdate.installing")}</p> : null}
      {phase === "downloading" ? (
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label={t("appUpdate.downloading", { percent: progress })}
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
            <button ref={laterRef} type="button" className={styles.secondary} onClick={onLater}>
              {t("appUpdate.later")}
            </button>
            <button type="button" className={styles.primary} disabled={updateDisabled} onClick={onUpdate}>
              {t("appUpdate.update")}
            </button>
          </>
        ) : null}
        {phase === "checking" || phase === "arming" || phase === "installing" ? (
          <button type="button" className={styles.secondary} disabled>
            {phase === "checking"
              ? t("appUpdate.checking")
              : phase === "arming"
                ? t("appUpdate.arming")
                : t("appUpdate.installing")}
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
        {phase === "upToDate" ? (
          <button ref={laterRef} type="button" className={styles.primary} onClick={onClose}>
            {t("appUpdate.close")}
          </button>
        ) : null}
      </div>
    </AnimatedModalFrame>
  );
}
