import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";

import { Tooltip } from "../../shared/ui/Tooltip";

import { useAnimatedModal } from "../../shared/ui/useAnimatedModal";

import type { OperationNotice } from "../../features/selection/lib/fileOperation";

import styles from "./SelectionActions.module.scss";



type SelectionActionsProps = {

  count: number;

  canClear: boolean;

  deleteReason: string | null;

  deleteHint?: string;

  favoriteReason: string | null;

  restoreReason: string | null;

  showDelete?: boolean;

  showRestore: boolean;

  /** Inside «Избранное»: replace «В избранное» with mass unfavorite. */

  unfavoriteMode?: boolean;

  progressLabel: string | null;

  showCancel?: boolean;

  embedded?: boolean;

  photoToggle?: { selected: boolean; onToggle: () => void } | null;

  onClear: () => void;

  onDelete: () => void;

  onFavorite: () => void;

  onRestore: () => void;

  onCancel: () => void;

};



export function SelectionActions({

  count,

  canClear,

  deleteReason,

  deleteHint,

  favoriteReason,

  restoreReason,

  showDelete = true,

  showRestore,

  unfavoriteMode = false,

  progressLabel,

  showCancel = true,

  embedded = false,

  photoToggle = null,

  onClear,

  onDelete,

  onFavorite,

  onRestore,

  onCancel,

}: SelectionActionsProps) {

  const { t } = useTranslation();

  const resolvedDeleteHint = deleteHint ?? t("selection.deleteHint");

  const favoriteLabel = unfavoriteMode ? t("selection.unfavorite") : t("selection.favorite");

  const favoriteHint = unfavoriteMode ? t("selection.unfavoriteHint") : t("selection.favoriteHint");

  return (

    <div className={embedded ? styles.embedded : styles.panel} role="group" aria-label={t("selection.actionsAria")} data-scrollbar-obstacle="bottom">

      <span className={styles.count}>{t("selection.selectedCount", { count })}</span>

      {progressLabel ? <span className={styles.progress}>{progressLabel}</span> : null}

      {photoToggle ? (

        <Tooltip text={photoToggle.selected ? t("selection.deselectPhotoHint") : t("selection.selectPhotoHint")}>

          <button

            type="button"

            className={styles.action}

            aria-pressed={photoToggle.selected}

            onClick={photoToggle.onToggle}

          >

            {photoToggle.selected ? t("selection.deselectPhoto") : t("selection.selectPhoto")}

          </button>

        </Tooltip>

      ) : (

        <button type="button" className={styles.action} onClick={onClear} disabled={!canClear}>

          {t("selection.clearSelection")}

        </button>

      )}

      <span className={styles.actionWrap} title={favoriteReason ?? favoriteHint}>

        <button type="button" className={styles.action} disabled={favoriteReason !== null} onClick={onFavorite}>

          <StitchVueIcon name="favorite" className={styles.icon} />

          {favoriteLabel}

        </button>

      </span>

      {showDelete ? (

        <span className={styles.actionWrap} title={deleteReason ?? resolvedDeleteHint}>

          <button type="button" className={styles.action} disabled={deleteReason !== null} onClick={onDelete}>

            <StitchVueIcon name="trash" className={styles.icon} />

            {t("selection.delete")}

          </button>

        </span>

      ) : null}

      {showRestore ? (

        <span className={styles.actionWrap} title={restoreReason ?? t("selection.restoreHint")}>

          <button type="button" className={styles.action} disabled={restoreReason !== null} onClick={onRestore}>

            <StitchVueIcon name="file-restore" className={styles.icon} />

            {t("selection.restore")}

          </button>

        </span>

      ) : null}

      {progressLabel && showCancel ? (

        <button type="button" className={styles.action} onClick={onCancel}>

          {t("selection.cancel")}

        </button>

      ) : null}

    </div>

  );

}



/** Сколько тост остаётся на экране (пауза при наведении). */

export const NOTICE_DURATION_MS = 5000;



/** Текст/код ошибки для failed-тоста; сводку «Скопировано: 0 · Ошибок: N» не подмешиваем. */

function failedNoticeMessage(notice: OperationNotice): string {

  const fromDetails = notice.details.map((part) => part.trim()).filter(Boolean);

  const unique: string[] = [];

  for (const part of fromDetails) {

    if (!unique.includes(part)) {

      unique.push(part);

    }

  }

  if (unique.length > 0) {

    return unique.join(" · ");

  }

  return notice.text.trim();

}



export function OperationNoticeView({

  notice,

  onUndo,

  onDismiss,

}: {

  notice: OperationNotice;

  onUndo?: () => void;

  onDismiss: () => void;

}) {

  const { t } = useTranslation();

  const errorTone = notice.tone === "failed" || notice.tone === "partial";

  const failedMessage = notice.tone === "failed" ? failedNoticeMessage(notice) : "";

  const displayText =

    notice.tone === "failed"

      ? failedMessage || t("errors.unknown")

      : notice.text;

  const showDetails = notice.tone !== "failed" && notice.details.length > 0;

  const timerKey = `${notice.tone}:${notice.title ?? ""}:${notice.text}:${notice.undoIds?.join(",") ?? ""}`;

  return (

    <div

      className={errorTone ? `${styles.notice} ${styles.noticeError}` : styles.notice}

      role="status"

      aria-live="polite"

      onClick={onDismiss}

    >

      <div className={styles.noticeContent}>

        <div className={styles.noticeBody}>

          {notice.title ? <p className={styles.noticeTitle}>{notice.title}</p> : null}

          <p className={styles.noticeText}>{displayText}</p>

          {showDetails ? (

            <ul className={styles.noticeList}>

              {notice.details.map((line) => (

                <li key={line}>{line}</li>

              ))}

            </ul>

          ) : null}

        </div>

        {onUndo ? (

          <button

            type="button"

            className={styles.noticeUndo}

            onClick={(event) => {

              event.stopPropagation();

              onUndo();

            }}

          >

            {t("common.undo")}

          </button>

        ) : null}

      </div>

      <div className={styles.noticeTimer} aria-hidden="true">

        <div

          key={timerKey}

          className={styles.noticeTimerBar}

          style={{ animationDuration: `${NOTICE_DURATION_MS}ms` }}

          onAnimationEnd={onDismiss}

        />

      </div>

    </div>

  );

}



export function ConfirmMoveDialog({

  open,

  text,

  detail,

  confirmLabel,

  cancelLabel,

  onCancel,

  onConfirm,

}: {

  open: boolean;

  text: string;

  detail?: ReactNode;

  confirmLabel?: string;

  cancelLabel?: string;

  onCancel: () => void;

  onConfirm: () => void;

}) {

  const { t } = useTranslation();

  const resolvedConfirmLabel = confirmLabel ?? t("selection.moveConfirmLabel");

  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");

  const { mounted, phase } = useAnimatedModal(open);

  if (!mounted) {

    return null;

  }

  return (

    <div className={styles.backdrop} data-modal-phase={phase} role="presentation" onClick={onCancel}>

      <div

        className={styles.dialog}

        data-modal-phase={phase}

        role="dialog"

        aria-modal="true"

        aria-labelledby="confirm-move-title"

        onClick={(event) => event.stopPropagation()}

      >

        <p id="confirm-move-title" className={styles.dialogText}>

          {text}

        </p>

        {detail ? <div className={styles.dialogDetail}>{detail}</div> : null}

        <div className={styles.dialogActions}>

          <button type="button" className={styles.dialogButton} onClick={onCancel}>

            {resolvedCancelLabel}

          </button>

          <button type="button" className={styles.dialogPrimary} onClick={onConfirm}>

            {resolvedConfirmLabel}

          </button>

        </div>

      </div>

    </div>

  );

}

