import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import { Tooltip } from "../../shared/ui/Tooltip";
import { useAnimatedModal } from "../../shared/ui/useAnimatedModal";
import styles from "./RenameFolderDialog.module.scss";

type RenameFolderDialogProps = {
  open: boolean;
  initialName: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
};

export function RenameFolderDialog({ open, initialName, onCancel, onConfirm }: RenameFolderDialogProps) {
  const { t } = useTranslation();
  const { mounted, phase } = useAnimatedModal(open);
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(initialName);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, initialName]);

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
        aria-labelledby="rename-folder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="rename-folder-title" className={styles.title}>
          {t("folder.renameTitle")}
        </h2>
        <input
          ref={inputRef}
          className={styles.input}
          value={name}
          aria-label={t("folder.renameInputAria")}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm(name);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <div className={styles.actions}>
          <div className={styles.actionSlot}>
            <button type="button" className={styles.control} aria-label={t("folder.cancelAria")} onClick={onCancel}>
              <StitchVueIcon name="window-close" className={styles.icon} />
            </button>
          </div>
          <div className={styles.actionSlot}>
            <Tooltip text={t("folder.save")}>
              <button
                type="button"
                className={styles.controlPrimary}
                aria-label={t("folder.saveAria")}
                disabled={name.trim().length === 0}
                onClick={() => onConfirm(name)}
              >
                <StitchVueIcon name="check" className={styles.icon} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
