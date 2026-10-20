import { useEffect, useRef } from "react";

import type { FolderShortcut } from "../../entities/folder/types";

import { useTranslation } from "react-i18next";

import menuStyles from "../../shared/ui/ContextMenu.module.scss";

export type FolderContextTarget = {
  folder: FolderShortcut;
  parentDirectory: string;
  x: number;
  y: number;
  canRename: boolean;
  canDeleteEmptyService: boolean;
  canRecycleTrashFolder: boolean;
};

type FolderContextMenuProps = {
  target: FolderContextTarget | null;
  onClose: () => void;
  onOpenInExplorer: (target: FolderContextTarget) => void;
  onRename: (target: FolderContextTarget) => void;
  onDelete: (target: FolderContextTarget) => void;
  onRecycleTrash: (target: FolderContextTarget) => void;
};

export function FolderContextMenu({
  target,
  onClose,
  onOpenInExplorer,
  onRename,
  onDelete,
  onRecycleTrash,
}: FolderContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu && event.target instanceof Node && menu.contains(event.target)) {
        return;
      }
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [target, onClose]);

  if (!target) {
    return null;
  }

  const style = {
    left: Math.min(target.x, window.innerWidth - 200),
    top: Math.min(target.y, window.innerHeight - 160),
  };

  const showEmptyDelete = target.canDeleteEmptyService && target.folder.serviceRole !== "trash";

  return (
    <div
      ref={menuRef}
      className={menuStyles.menu}
      style={style}
      role="menu"
      aria-label={t("folder.menuAria")}
      onContextMenu={(event) => event.preventDefault()}
      onPointerLeave={() => onClose()}
    >
      <button
        type="button"
        className={menuStyles.item}
        role="menuitem"
        onClick={() => onOpenInExplorer(target)}
      >
        {t("folder.openInExplorer")}
      </button>
      {target.canRename ? (
        <button type="button" className={menuStyles.item} role="menuitem" onClick={() => onRename(target)}>
          {t("folder.rename")}
        </button>
      ) : null}
      {target.canRecycleTrashFolder ? (
        <button
          type="button"
          className={`${menuStyles.item} ${menuStyles.itemDanger}`}
          role="menuitem"
          onClick={() => onRecycleTrash(target)}
        >
          {t("trash.recycleFolderMenu")}
        </button>
      ) : null}
      {showEmptyDelete ? (
        <button
          type="button"
          className={`${menuStyles.item} ${menuStyles.itemDanger}`}
          role="menuitem"
          onClick={() => onDelete(target)}
        >
          {t("folder.deleteEmpty")}
        </button>
      ) : null}
    </div>
  );
}
