import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { usePathCopyFeedback } from "../../shared/hooks/usePathCopyFeedback";
import { formatDateTime, formatFileSize } from "../../shared/i18n/formatters.ts";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import { Tooltip } from "../../shared/ui/Tooltip";
import { useAnimatedModal } from "../../shared/ui/useAnimatedModal";
import styles from "./PhotoPropertiesDialog.module.scss";

export type PhotoProperties = {
  name: string;
  path: string;
  extension: string;
  size: number;
  width: number | null;
  height: number | null;
  modifiedAt: number | null;
  createdAt: number | null;
  capturedAt: string | null;
  orientation: number | null;
  camera: string | null;
  lens: string | null;
  iso: string | null;
  exposure: string | null;
  aperture: string | null;
  gps: string | null;
  colorProfile: string | null;
};

type PhotoPropertiesDialogProps = {
  open: boolean;
  path: string | null;
  originPath?: string | null;
  onClose: () => void;
};

export function PhotoPropertiesDialog({ open, path, originPath, onClose }: PhotoPropertiesDialogProps) {
  const { t } = useTranslation();
  const pathRef = useRef<string | null>(path);
  if (path) {
    pathRef.current = path;
  }
  const displayPath = path ?? pathRef.current;
  const { mounted, phase } = useAnimatedModal(open);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [props, setProps] = useState<PhotoProperties | null>(null);
  const { pathCopied, copyPath } = usePathCopyFeedback(displayPath ?? "");

  useEffect(() => {
    if (!open || !displayPath) {
      return;
    }
    focusReturnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true, focusVisible: false });
    let alive = true;
    void invoke<PhotoProperties>("image_properties", { path: displayPath })
      .then((value) => {
        if (!alive) {
          return;
        }
        setProps(value);
        setState("ready");
      })
      .catch((reason: unknown) => {
        if (!alive) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setState("error");
      });
    return () => {
      alive = false;
    };
  }, [open, displayPath]);

  useEffect(() => {
    if (open || mounted) {
      return;
    }
    focusReturnRef.current?.focus({ preventScroll: true });
    focusReturnRef.current = null;
  }, [open, mounted]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }
      const items = [...panelRef.current.querySelectorAll<HTMLElement>("button, [href], input, [tabindex='0']")].filter(
        (item) => !item.hasAttribute("disabled"),
      );
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const rows = props ? propertyRows(props, originPath, t) : [];

  if (!mounted || !displayPath) {
    return null;
  }

  return (
    <div className={styles.backdrop} data-modal-phase={phase} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.dialog}
        data-modal-phase={phase}
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-properties-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="photo-properties-title">{t("properties.title")}</h2>
          <button ref={closeRef} type="button" className={styles.close} aria-label={t("common.closeWindowAria")} onClick={onClose}>
            <StitchVueIcon name="window-close" className={styles.closeIcon} />
          </button>
        </header>
        <div className={styles.body}>
          {state === "loading" ? <p>{t("common.loading")}</p> : null}
          {state === "error" ? <p>{error || t("properties.loadError")}</p> : null}
          {state === "ready" ? (
            <dl className={styles.list}>
              {rows.map((row) => (
                <div key={row.label} className={styles.row}>
                  <dt className={row.copy ? styles.labelWithAction : undefined}>
                    <span>{row.label}</span>
                    {row.copy ? (
                      <Tooltip text={t("common.copyPath")}>
                        <button
                          type="button"
                          className={styles.copyButton}
                          aria-label={t("common.copyPathAria")}
                          aria-pressed={pathCopied}
                          onClick={copyPath}
                        >
                          <StitchVueIcon name="copy" className={styles.copyIcon} />
                        </button>
                      </Tooltip>
                    ) : null}
                  </dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function propertyRows(
  props: PhotoProperties,
  originPath: string | null | undefined,
  t: TFunction,
): { label: string; value: string; copy?: boolean }[] {
  const rows: { label: string; value: string; copy?: boolean }[] = [
    { label: t("properties.fields.name"), value: text(props.name, t) },
  ];
  if (originPath) {
    rows.push({ label: t("trash.originalPath"), value: text(originPath, t), copy: true });
  }
  rows.push(
    { label: t("properties.fields.path"), value: text(props.path, t), copy: true },
    { label: t("properties.fields.format"), value: text(props.extension, t) },
    { label: t("properties.fields.fileSize"), value: formatBytes(props.size, t) },
    {
      label: t("properties.fields.dimensions"),
      value:
        props.width && props.height
          ? t("properties.dimensionsValue", { width: props.width, height: props.height })
          : t("common.noData"),
    },
    { label: t("properties.fields.modifiedAt"), value: formatTime(props.modifiedAt, t) },
    { label: t("properties.fields.createdAt"), value: formatTime(props.createdAt, t) },
    { label: t("properties.fields.capturedAt"), value: text(props.capturedAt, t) },
    { label: t("properties.fields.orientation"), value: props.orientation ? String(props.orientation) : t("common.noData") },
    { label: t("properties.fields.camera"), value: text(props.camera, t) },
    { label: t("properties.fields.lens"), value: text(props.lens, t) },
    { label: t("properties.fields.iso"), value: text(props.iso, t) },
    { label: t("properties.fields.exposure"), value: text(props.exposure, t) },
    { label: t("properties.fields.aperture"), value: text(props.aperture, t) },
    { label: t("properties.fields.gps"), value: text(props.gps, t) },
    { label: t("properties.fields.colorProfile"), value: text(props.colorProfile, t) },
  );
  return rows;
}

function text(value: string | null | undefined, t: TFunction): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : t("common.noData");
}

function formatTime(value: number | null, t: TFunction): string {
  if (!value) {
    return t("common.noData");
  }
  return formatDateTime(value);
}

function formatBytes(value: number, t: TFunction): string {
  if (!value) {
    return t("common.noData");
  }
  return formatFileSize(value);
}
