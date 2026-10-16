import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { folderDisplayName } from "../../entities/folder/folderDisplayName";
import { serviceFolderHint } from "../../entities/folder/serviceFolder";
import type { FolderShortcut } from "../../entities/folder/types";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/Tooltip";
import styles from "../../pages/gallery/GalleryPage.module.scss";

type FolderViewTileProps = {
  folder: FolderShortcut;
  tipClassName?: string;
  entering?: boolean;
  exiting?: boolean;
  onOpen: (path: string) => void;
  onContextMenu?: (event: MouseEvent, folder: FolderShortcut) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  children: ReactNode;
};

function labelTruncated(label: HTMLElement): boolean {
  return label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1;
}

export function FolderViewTile({
  folder,
  tipClassName,
  entering = false,
  exiting = false,
  onOpen,
  onContextMenu,
  onPointerEnter,
  onPointerLeave,
  children,
}: FolderViewTileProps) {
  const { i18n } = useTranslation();
  const labelRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  const hint = serviceFolderHint(folder.serviceRole);
  const displayName = folderDisplayName(folder);
  const tipEnabled = Boolean(hint) || truncated;
  const serviceTile = folder.serviceRole === "favorites" || folder.serviceRole === "trash";

  useLayoutEffect(() => {
    const label = labelRef.current;
    if (!label) {
      return;
    }
    const check = () => {
      setTruncated(labelTruncated(label));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(label);
    const frame = window.requestAnimationFrame(check);
    return () => {
      window.cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [displayName, i18n.language]);

  return (
    <Tooltip text={hint ?? displayName} enabled={tipEnabled} className={tipClassName}>
      <button
        type="button"
        className={serviceTile ? `${styles.tile} ${styles.tileService}` : styles.tile}
        data-service={folder.serviceRole ?? undefined}
        data-folder-path={folder.path}
        data-enter={entering ? "true" : undefined}
        data-exit={exiting ? "true" : undefined}
        onClick={() => onOpen(folder.path)}
        onContextMenu={(event) => onContextMenu?.(event, folder)}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        {children}
        <span ref={labelRef} className={styles.tileLabel}>
          {displayName}
        </span>
      </button>
    </Tooltip>
  );
}
