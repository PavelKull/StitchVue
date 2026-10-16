import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openExternalLink } from "../../features/settings/openExternalLink";
import type { SupportMilestone } from "../../features/support-reminder/supportReminderTypes";
import { BOOSTY_URL, CLOUDTIPS_URL } from "../../shared/config";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import { useAnimatedModal } from "../../shared/ui/useAnimatedModal";
import styles from "./SupportReminderDialog.module.scss";

type SupportReminderDialogProps = {
  open: boolean;
  milestone: SupportMilestone | null;
  onDismiss: () => void;
  onNeverShowAgain: () => void;
  onDonateActionComplete: () => void;
};

export function SupportReminderDialog({
  open,
  milestone,
  onDismiss,
  onNeverShowAgain,
  onDonateActionComplete,
}: SupportReminderDialogProps) {
  const { t } = useTranslation();
  const { mounted, phase } = useAnimatedModal(open);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const linkBusyRef = useRef(false);

  const showNeverAgain = milestone === "launch20" || milestone === "month3";
  const dismissLabel =
    milestone === "month3" ? t("supportReminder.close") : t("supportReminder.notNow");

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }
    closeRef.current?.focus({ preventScroll: true, focusVisible: false });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onDismiss]);

  async function openLink(kind: "cloudtips" | "boosty") {
    if (linkBusyRef.current) {
      return;
    }
    linkBusyRef.current = true;
    setError(null);
    try {
      await openExternalLink(kind);
      onDonateActionComplete();
    } catch {
      setError(t("supportReminder.openLinkFailed"));
      linkBusyRef.current = false;
    }
  }

  if (!mounted) {
    return null;
  }

  return (
    <div className={styles.backdrop} data-modal-phase={phase} role="presentation" onClick={onDismiss}>
      <div
        className={styles.dialog}
        data-modal-phase={phase}
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-reminder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          aria-label={t("common.close")}
          onClick={onDismiss}
        >
          <StitchVueIcon name="window-close" className={styles.closeIcon} />
        </button>
        <div className={styles.iconWrap} aria-hidden="true">
          <StitchVueIcon name="heart" className={styles.heartIcon} />
        </div>
        <h2 id="support-reminder-title" className={styles.title}>
          {t("supportReminder.title")}
        </h2>
        <p className={styles.body}>{t("supportReminder.body")}</p>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.donateRow}>
          {CLOUDTIPS_URL ? (
            <button type="button" className={styles.donateButton} onClick={() => void openLink("cloudtips")}>
              <span>CloudTips</span>
              <StitchVueIcon name="arrow-up-right" className={styles.externalIcon} />
            </button>
          ) : null}
          {BOOSTY_URL ? (
            <button type="button" className={styles.donateButton} onClick={() => void openLink("boosty")}>
              <span>Boosty</span>
              <StitchVueIcon name="arrow-up-right" className={styles.externalIcon} />
            </button>
          ) : null}
        </div>
        <div className={styles.secondaryRow}>
          <button type="button" className={styles.textButton} onClick={onDismiss}>
            {dismissLabel}
          </button>
          {showNeverAgain ? (
            <button type="button" className={styles.textButton} onClick={onNeverShowAgain}>
              {t("supportReminder.neverShow")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
