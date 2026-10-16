import { getVersion } from "@tauri-apps/api/app";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { LAYOUT_MODES } from "../../entities/gallery/layoutMode";
import { formatCacheSize } from "../../features/settings/lib/formatCacheSize";
import { openExternalLink } from "../../features/settings/api/openExternalLink";
import {
  loadSupportReminderState,
  setSupportReminderNeverShowAgain,
} from "../../features/support-reminder/lib/supportReminderState";
import {
  BUG_REPORT_SUBJECT,
  CONTACT_SUBJECT,
  resolveReportProblemRoute,
} from "../../features/settings/api/reportProblem";
import type { AppPreferences, SettingsTab } from "../../features/settings/lib/settingsPreferences";
import {
  BOOSTY_URL,
  CLOUDTIPS_URL,
  GITHUB_REPO_URL,
  SUPPORT_EMAIL,
  githubIssuesUrl,
  supportMailtoUrl,
} from "../../shared/config";
import {
  isShippedLocale,
  LOCALE_NATIVE_LABELS,
  setAppLocale,
  USER_FACING_LOCALES,
  type UserFacingLocale,
} from "../../shared/i18n";
import { useTranslation } from "react-i18next";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import type { StitchVueIconName } from "../../shared/icons/stitchvue-icons";
import { copyToClipboard } from "../../shared/lib/copyToClipboard";
import { Tooltip } from "../../shared/ui/Tooltip";
import { useAnimatedModal } from "../../shared/ui/useAnimatedModal";
import { ConfirmMoveDialog } from "../selection-actions/SelectionActions";
import styles from "./SettingsDialog.module.scss";

const APP_ICON = new URL("../../../src-tauri/icons/icon.svg", import.meta.url).href;

type CacheUsage = { usedBytes: number; limitBytes: number; ttlSecs: number | null };

type SettingsDialogProps = {
  open: boolean;
  preferences: AppPreferences;
  usage: CacheUsage | null;
  onClose: () => void;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
  onResetDefaults: () => void;
  onClearCache: () => Promise<void>;
  onCacheLimit: (bytes: number) => Promise<CacheUsage>;
  onCacheTtl: (preset: string) => Promise<CacheUsage>;
  ttlPreset: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

const CACHE_LIMITS = [
  512 * 1024 * 1024,
  1024 * 1024 * 1024,
  2 * 1024 * 1024 * 1024,
  5 * 1024 * 1024 * 1024,
];

export function SettingsDialog({
  open,
  preferences,
  usage,
  onClose,
  onPreferencesChange,
  onResetDefaults,
  onClearCache,
  onCacheLimit,
  onCacheTtl,
  ttlPreset,
  returnFocusRef,
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const tabs: { id: SettingsTab; label: string; icon: StitchVueIconName }[] = [
    { id: "gallery", label: t("settings.tabs.gallery"), icon: "layout-masonry" },
    { id: "interface", label: t("settings.tabs.interface"), icon: "sidebar-show" },
    { id: "performance", label: t("settings.tabs.performance"), icon: "file-image" },
    { id: "support", label: t("settings.tabs.support"), icon: "favorite" },
    { id: "about", label: t("settings.tabs.about"), icon: "info" },
  ];
  const [tab, setTab] = useState<SettingsTab>("gallery");
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [limitBytes, setLimitBytes] = useState(usage?.limitBytes ?? CACHE_LIMITS[1]);
  const [ttlValue, setTtlValue] = useState(ttlPreset);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { mounted, phase } = useAnimatedModal(open);

  useEffect(() => {
    if (usage?.limitBytes) {
      setLimitBytes(usage.limitBytes);
    }
  }, [usage?.limitBytes]);

  useEffect(() => {
    setTtlValue(ttlPreset);
  }, [ttlPreset]);

  const focusReturnRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement;
    focusReturnRef.current = previous instanceof HTMLElement ? previous : null;
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusTarget?.focus({ preventScroll: true });

    function collectFocusable(): HTMLElement[] {
      const selector =
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
      const nodes: HTMLElement[] = [];
      if (dialogRef.current) {
        nodes.push(...dialogRef.current.querySelectorAll<HTMLElement>(selector));
      }
      const confirmTitle = document.getElementById("confirm-move-title");
      const confirmDialog = confirmTitle?.closest<HTMLElement>("[role='dialog']");
      if (confirmDialog) {
        nodes.push(...confirmDialog.querySelectorAll<HTMLElement>(selector));
      }
      return nodes;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") {
        return;
      }
      const focusable = collectFocusable();
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, confirmClearCache, confirmReset]);

  useEffect(() => {
    if (open || mounted) {
      return;
    }
    if (returnFocusRef?.current) {
      returnFocusRef.current.focus({ preventScroll: true, focusVisible: false });
    } else {
      focusReturnRef.current?.focus({ preventScroll: true, focusVisible: false });
    }
    focusReturnRef.current = null;
  }, [open, mounted, returnFocusRef]);

  const handleClose = useCallback(() => {
    if (confirmClearCache || confirmReset) {
      return;
    }
    onClose();
  }, [confirmClearCache, confirmReset, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (confirmClearCache) {
        setConfirmClearCache(false);
        return;
      }
      if (confirmReset) {
        setConfirmReset(false);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open, confirmClearCache, confirmReset, onClose]);

  if (!mounted) {
    return null;
  }

  async function runClearCache() {
    setCacheBusy(true);
    setCacheError(null);
    try {
      await onClearCache();
      setConfirmClearCache(false);
    } catch {
      setCacheError(t("settings.performance.clearFailed"));
    } finally {
      setCacheBusy(false);
    }
  }

  async function changeLimit(bytes: number) {
    const previous = limitBytes;
    setLimitBytes(bytes);
    setCacheError(null);
    try {
      await onCacheLimit(bytes);
    } catch {
      setLimitBytes(previous);
      setCacheError(t("settings.performance.limitFailed"));
    }
  }

  async function changeTtl(preset: string) {
    const previous = ttlValue;
    setTtlValue(preset);
    setCacheError(null);
    try {
      await onCacheTtl(preset);
    } catch {
      setTtlValue(previous);
      setCacheError(t("settings.performance.ttlFailed"));
    }
  }

  const used = usage?.usedBytes ?? 0;
  const limit = usage?.limitBytes ?? limitBytes;
  const usageRatio = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <>
      <div
        className={styles.backdrop}
        data-modal-phase={phase}
        onClick={handleClose}
        onWheel={(event) => event.stopPropagation()}
        role="presentation"
      >
        <div
          ref={dialogRef}
          className={styles.dialog}
          data-modal-phase={phase}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <header className={styles.header}>
            <h2 id={titleId}>{t("settings.title")}</h2>
            <button type="button" className={styles.close} aria-label={t("common.closeWindowAria")} onClick={handleClose}>
              <StitchVueIcon name="window-close" className={styles.closeIcon} />
            </button>
          </header>

          <div className={styles.body}>
            <nav className={styles.tabs} aria-label={t("settings.tabsAria")}>
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tab === item.id ? styles.tabActive : styles.tab}
                  aria-current={tab === item.id ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  <StitchVueIcon name={item.icon} className={styles.tabIcon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>

            <div className={styles.panelArea}>
              <div className={styles.panelStack}>
                <div className={styles.panelPane} data-active={tab === "gallery"} aria-hidden={tab !== "gallery"}>
                  <GalleryPanel preferences={preferences} onChange={onPreferencesChange} />
                </div>
                <div className={styles.panelPane} data-active={tab === "interface"} aria-hidden={tab !== "interface"}>
                  <InterfacePanel preferences={preferences} onChange={onPreferencesChange} />
                </div>
                <div className={styles.panelPane} data-active={tab === "performance"} aria-hidden={tab !== "performance"}>
                  <PerformancePanel
                    used={used}
                    limit={limit}
                    usageRatio={usageRatio}
                    limitBytes={limitBytes}
                    ttlValue={ttlValue}
                    cacheBusy={cacheBusy}
                    cacheError={cacheError}
                    onRequestClear={() => setConfirmClearCache(true)}
                    onLimitChange={(bytes) => void changeLimit(bytes)}
                    onTtlChange={(preset) => void changeTtl(preset)}
                  />
                </div>
                <div className={styles.panelPane} data-active={tab === "support"} aria-hidden={tab !== "support"}>
                  <SupportPanel />
                </div>
                <div className={styles.panelPane} data-active={tab === "about"} aria-hidden={tab !== "about"}>
                  <AboutPanel />
                </div>
              </div>
            </div>
          </div>

          <footer className={styles.footer}>
            <button type="button" className={styles.resetLink} onClick={() => setConfirmReset(true)}>
              {t("settings.resetDefaults")}
            </button>
          </footer>
        </div>
      </div>

      <ConfirmMoveDialog
        open={confirmClearCache}
        text={t("settings.confirmClearCache")}
        confirmLabel={t("settings.confirmClearCacheLabel")}
        onCancel={() => setConfirmClearCache(false)}
        onConfirm={() => void runClearCache()}
      />

      <ConfirmMoveDialog
        open={confirmReset}
        text={t("settings.confirmReset")}
        confirmLabel={t("settings.confirmResetLabel")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          onResetDefaults();
          setConfirmReset(false);
        }}
      />
    </>
  );
}

function GalleryPanel({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (patch: Partial<AppPreferences>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h3>{t("settings.gallery.heading")}</h3>
      <fieldset className={styles.fieldset}>
        <legend>{t("settings.gallery.defaultLayoutLegend")}</legend>
        {LAYOUT_MODES.map((mode) => (
          <label key={mode} className={styles.radio}>
            <input
              type="radio"
              name="default-layout"
              checked={preferences.defaultLayoutMode === mode}
              onChange={() => onChange({ defaultLayoutMode: mode })}
            />
            {t(`gallery.layout.${mode}`)}
          </label>
        ))}
      </fieldset>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={preferences.rememberLayoutMode}
          onChange={(event) => onChange({ rememberLayoutMode: event.target.checked })}
        />
        {t("settings.gallery.rememberLayoutMode")}
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={preferences.rememberZoom}
          onChange={(event) => onChange({ rememberZoom: event.target.checked })}
        />
        {t("settings.gallery.rememberZoom")}
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={preferences.rememberLastFolder}
          onChange={(event) => onChange({ rememberLastFolder: event.target.checked })}
        />
        {t("settings.gallery.rememberLastFolder")}
      </label>
      <fieldset className={styles.block}>
        <legend>{t("settings.gallery.confirmMoveLegend")}</legend>
        <label className={styles.radio}>
          <input
            type="radio"
            name="confirm-move"
            checked={preferences.confirmMove === "always"}
            onChange={() => onChange({ confirmMove: "always" })}
          />
          {t("settings.gallery.confirmMoveAlways")}
        </label>
        <label className={styles.radio}>
          <input
            type="radio"
            name="confirm-move"
            checked={preferences.confirmMove === "mass"}
            onChange={() => onChange({ confirmMove: "mass" })}
          />
          {t("settings.gallery.confirmMoveMass")}
        </label>
        <label className={styles.radio}>
          <input
            type="radio"
            name="confirm-move"
            checked={preferences.confirmMove === "never"}
            onChange={() => onChange({ confirmMove: "never" })}
          />
          {t("settings.gallery.confirmMoveNever")}
        </label>
      </fieldset>
    </>
  );
}

function InterfacePanel({
  preferences,
  onChange,
}: {
  preferences: AppPreferences;
  onChange: (patch: Partial<AppPreferences>) => void;
}) {
  const { t } = useTranslation();

  async function onLocaleChange(locale: UserFacingLocale) {
    if (!isShippedLocale(locale) || preferences.locale === locale) {
      return;
    }
    await setAppLocale(locale);
    onChange({ locale });
  }

  return (
    <>
      <h3>{t("settings.interface.heading")}</h3>
      <fieldset className={styles.fieldset}>
        <legend>{t("settings.interface.language")}</legend>
        {USER_FACING_LOCALES.map((locale) => {
          const shipped = isShippedLocale(locale);
          return (
            <label key={locale} className={styles.radio}>
              <input
                type="radio"
                name="ui-language"
                checked={preferences.locale === locale}
                disabled={!shipped}
                onChange={() => void onLocaleChange(locale)}
              />
              {LOCALE_NATIVE_LABELS[locale]}
            </label>
          );
        })}
        <p className={styles.hint}>{t("settings.interface.languageHint")}</p>
      </fieldset>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={preferences.panelsPeekOnEdge}
          onChange={(event) => onChange({ panelsPeekOnEdge: event.target.checked })}
        />
        {t("settings.interface.panelsPeekOnEdge")}
      </label>
      <p className={styles.hint}>{t("settings.interface.panelsPeekHint")}</p>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={preferences.rememberPanelsPinned}
          onChange={(event) => onChange({ rememberPanelsPinned: event.target.checked })}
        />
        {t("settings.interface.rememberPanelsPinned")}
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={preferences.showPhotoDates}
          onChange={(event) => onChange({ showPhotoDates: event.target.checked })}
        />
        {t("settings.interface.showPhotoDates")}
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={preferences.animationsEnabled}
          onChange={(event) => onChange({ animationsEnabled: event.target.checked })}
        />
        {t("settings.interface.animations")}
      </label>
    </>
  );
}

function PerformancePanel({
  used,
  limit,
  usageRatio,
  limitBytes,
  ttlValue,
  cacheBusy,
  cacheError,
  onRequestClear,
  onLimitChange,
  onTtlChange,
}: {
  used: number;
  limit: number;
  usageRatio: number;
  limitBytes: number;
  ttlValue: string;
  cacheBusy: boolean;
  cacheError: string | null;
  onRequestClear: () => void;
  onLimitChange: (bytes: number) => void;
  onTtlChange: (preset: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <h3>{t("settings.performance.heading")}</h3>
      <section className={styles.block}>
        <h4>{t("settings.performance.cacheHeading")}</h4>
        <p className={styles.meta}>
          {t("settings.performance.cacheUsed", {
            used: formatCacheSize(used),
            limit: formatCacheSize(limit),
          })}
        </p>
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressFill} style={{ width: `${usageRatio}%` }} />
        </div>
        {cacheError ? <p className={styles.error}>{cacheError}</p> : null}
        <button type="button" className={styles.action} disabled={cacheBusy} onClick={onRequestClear}>
          {t("settings.performance.clearCache")}
        </button>
        <label className={styles.label}>
          {t("settings.performance.maxSize")}
          <select value={limitBytes} disabled={cacheBusy} onChange={(event) => onLimitChange(Number(event.target.value))}>
            <option value={CACHE_LIMITS[0]}>{t("settings.performance.limit512")}</option>
            <option value={CACHE_LIMITS[1]}>{t("settings.performance.limit1gb")}</option>
            <option value={CACHE_LIMITS[2]}>{t("settings.performance.limit2gb")}</option>
            <option value={CACHE_LIMITS[3]}>{t("settings.performance.limit5gb")}</option>
          </select>
        </label>
        <label className={styles.label}>
          {t("settings.performance.ttlLabel")}
          <select value={ttlValue} disabled={cacheBusy} onChange={(event) => onTtlChange(event.target.value)}>
            <option value="3">{t("settings.performance.ttl3")}</option>
            <option value="7">{t("settings.performance.ttl7")}</option>
            <option value="30">{t("settings.performance.ttl30")}</option>
            <option value="never">{t("settings.performance.ttlNever")}</option>
          </select>
        </label>
      </section>
    </>
  );
}

function SupportPanel() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [hideReminders, setHideReminders] = useState(
    () => loadSupportReminderState().neverShowAgain,
  );

  async function open(kind: "cloudtips" | "boosty") {
    setError(null);
    try {
      await openExternalLink(kind);
    } catch {
      setError(t("settings.support.openLinkFailed"));
    }
  }

  return (
    <>
      <h3>{t("settings.support.heading")}</h3>
      <p className={styles.hint}>{t("settings.support.body")}</p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <article className={styles.supportCard}>
        <h4>CloudTips</h4>
        <p className={styles.meta}>{t("settings.support.cloudtipsMeta")}</p>
        {CLOUDTIPS_URL ? (
          <button type="button" className={styles.primaryAction} onClick={() => void open("cloudtips")}>
            {t("settings.support.cloudtipsButton")}
          </button>
        ) : (
          <p className={styles.meta}>{t("settings.support.linkUnavailable")}</p>
        )}
      </article>
      <article className={styles.supportCard}>
        <h4>Boosty</h4>
        <p className={styles.meta}>{t("settings.support.boostyMeta")}</p>
        {BOOSTY_URL ? (
          <button type="button" className={styles.primaryAction} onClick={() => void open("boosty")}>
            {t("settings.support.boostyButton")}
          </button>
        ) : (
          <p className={styles.meta}>{t("settings.support.linkUnavailable")}</p>
        )}
      </article>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={hideReminders}
          onChange={(event) => {
            const next = event.target.checked;
            setHideReminders(next);
            setSupportReminderNeverShowAgain(next);
          }}
        />
        {t("settings.support.hideReminders")}
      </label>
    </>
  );
}

function AboutPanel() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [licenseText, setLicenseText] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const emailCopyTimerRef = useRef(0);
  const reportRoute = resolveReportProblemRoute(githubIssuesUrl(), SUPPORT_EMAIL);
  const canReportProblem = reportRoute.channel !== "unavailable";
  const canContact = Boolean(SUPPORT_EMAIL && supportMailtoUrl(CONTACT_SUBJECT));

  useEffect(() => {
    void getVersion()
      .then((value) => setVersion(value))
      .catch(() => setVersion(null));
  }, []);

  useEffect(() => {
    return () => window.clearTimeout(emailCopyTimerRef.current);
  }, []);

  async function openRepo() {
    if (!GITHUB_REPO_URL) {
      return;
    }
    setLinkError(null);
    try {
      await openExternalLink("github_repo");
    } catch {
      setLinkError(t("settings.about.openRepoFailed"));
    }
  }

  async function reportProblem() {
    setFeedbackError(null);
    const route = resolveReportProblemRoute(githubIssuesUrl(), SUPPORT_EMAIL);
    try {
      if (route.channel === "github_issues") {
        await openExternalLink("github_issues");
        return;
      }
      if (route.channel === "mailto") {
        await openExternalLink("support_email", { subject: BUG_REPORT_SUBJECT });
        return;
      }
      setFeedbackError(t("settings.about.reportProblemFailed"));
    } catch {
      setFeedbackError(t("settings.about.reportProblemFailed"));
    }
  }

  async function copySupportEmail() {
    setContactError(null);
    const ok = await copyToClipboard(SUPPORT_EMAIL);
    if (ok) {
      setEmailCopied(true);
      window.clearTimeout(emailCopyTimerRef.current);
      emailCopyTimerRef.current = window.setTimeout(() => setEmailCopied(false), 1800);
      return;
    }
    setEmailCopied(false);
    setContactError(t("settings.about.contactCopyFailed"));
  }

  async function writeDeveloper() {
    setContactError(null);
    try {
      await openExternalLink("support_email", { subject: CONTACT_SUBJECT });
    } catch {
      setContactError(t("settings.about.contactOpenFailed"));
    }
  }

  async function toggleLicense() {
    if (licenseOpen) {
      setLicenseOpen(false);
      return;
    }
    setLicenseOpen(true);
    if (licenseText !== null) {
      return;
    }
    try {
      const response = await fetch("/third-party-notices.txt");
      setLicenseText(response.ok ? await response.text() : t("settings.about.licensesUnavailable"));
    } catch {
      setLicenseText(t("settings.about.licensesUnavailable"));
    }
  }

  return (
    <>
      <div className={styles.aboutHero}>
        <img src={APP_ICON} alt="" className={styles.aboutLogo} width={64} height={64} />
        <div>
          <h3 className={styles.aboutTitle}>StitchVue</h3>
          <p className={styles.meta}>{t("settings.about.version", { version: version ?? "—" })}</p>
          <p className={styles.hint}>{t("settings.about.tagline")}</p>
          <p className={styles.meta}>{t("settings.about.developer")}</p>
        </div>
      </div>
      {linkError ? <p className={styles.error}>{linkError}</p> : null}
      {GITHUB_REPO_URL ? (
        <div className={styles.linkList}>
          <button type="button" className={`${styles.aboutAction} ${styles.aboutActionNeutral}`} onClick={() => void openRepo()}>
            <span className={styles.aboutActionLabel}>{t("settings.about.githubRepo")}</span>
            <StitchVueIcon name="arrow-up-right" className={styles.aboutActionIcon} />
          </button>
        </div>
      ) : null}
      {canReportProblem ? (
        <section className={styles.aboutSection}>
          <h4>{t("settings.about.feedbackTitle")}</h4>
          <p className={styles.meta}>{t("settings.about.feedbackDescription")}</p>
          {feedbackError ? <p className={styles.error}>{feedbackError}</p> : null}
          <button
            type="button"
            className={`${styles.aboutAction} ${styles.aboutActionAccent}`}
            onClick={() => void reportProblem()}
          >
            <StitchVueIcon name="bug" className={styles.aboutActionIcon} />
            <span className={styles.aboutActionLabel}>{t("settings.about.reportProblem")}</span>
            <StitchVueIcon name="arrow-up-right" className={styles.aboutActionIcon} />
          </button>
        </section>
      ) : null}
      {canContact ? (
        <section className={styles.aboutSection}>
          <h4>{t("settings.about.contactTitle")}</h4>
          <p className={styles.meta}>{t("settings.about.contactDescription")}</p>
          {contactError ? <p className={styles.error}>{contactError}</p> : null}
          <div className={styles.contactEmailRow}>
            <span className={styles.contactEmail}>{SUPPORT_EMAIL}</span>
            <Tooltip text={emailCopied ? t("settings.about.contactCopied") : t("settings.about.contactCopy")}>
              <button
                type="button"
                className={styles.contactCopyIcon}
                aria-label={
                  emailCopied ? t("settings.about.contactCopiedAria") : t("settings.about.contactCopyAria")
                }
                aria-pressed={emailCopied}
                onClick={() => void copySupportEmail()}
              >
                <StitchVueIcon name={emailCopied ? "check" : "copy"} className={styles.contactCopyGlyph} />
              </button>
            </Tooltip>
            {emailCopied ? (
              <span className={styles.contactCopiedHint} aria-live="polite">
                {t("settings.about.contactCopied")}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={`${styles.aboutAction} ${styles.aboutActionNeutral}`}
            onClick={() => void writeDeveloper()}
          >
            <StitchVueIcon name="mail" className={styles.aboutActionIcon} />
            <span className={styles.aboutActionLabel}>{t("settings.about.contactWrite")}</span>
          </button>
        </section>
      ) : null}
      <section className={styles.aboutSection}>
        <button
          type="button"
          className={`${styles.aboutAction} ${styles.aboutActionNeutral} ${styles.aboutLicenseToggle}`}
          aria-expanded={licenseOpen}
          aria-controls="about-licenses-panel"
          onClick={() => void toggleLicense()}
        >
          <StitchVueIcon name="scale" className={styles.aboutActionIcon} />
          <span className={styles.aboutActionLabel}>{t("settings.about.licensesToggle")}</span>
          <StitchVueIcon
            name={licenseOpen ? "chevron-up" : "chevron-down"}
            className={styles.aboutActionIcon}
          />
        </button>
        {licenseOpen ? (
          <div
            id="about-licenses-panel"
            className={styles.licenseBox}
            role="region"
            aria-label={t("settings.about.licensesAria")}
          >
            <pre>{licenseText ?? t("common.loading")}</pre>
          </div>
        ) : null}
      </section>
    </>
  );
}
