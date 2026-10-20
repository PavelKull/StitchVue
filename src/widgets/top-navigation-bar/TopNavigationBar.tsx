import { type MouseEvent } from "react";

import { useTranslation } from "react-i18next";

import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";

import { Tooltip } from "../../shared/ui/Tooltip";

import { Breadcrumbs } from "./Breadcrumbs";

import styles from "./TopNavigationBar.module.scss";



type TopNavigationBarProps = {

  path: string | null;

  canBack: boolean;

  canForward: boolean;

  canUp: boolean;

  pinned: boolean;

  pathCopied: boolean;

  onBack: () => void;

  onForward: () => void;

  onUp: () => void;

  onNavigate: (path: string | null) => void;

  onCopyPath: () => void;

  onTogglePin: () => void;

  onOpenFolder: () => void;

  onFolderContextMenu?: (event: MouseEvent, path: string | null) => void;

};



export function TopNavigationBar({

  path,

  canBack,

  canForward,

  canUp,

  pinned,

  pathCopied,

  onBack,

  onForward,

  onUp,

  onNavigate,

  onCopyPath,

  onTogglePin,

  onOpenFolder,

  onFolderContextMenu,

}: TopNavigationBarProps) {

  const { t } = useTranslation();

  return (

    <header className={styles.bar} data-scrollbar-obstacle="top">

      <div className={styles.navCluster}>

        <button type="button" className={styles.iconButton} aria-label={t("topNav.backAria")} disabled={!canBack} onClick={onBack}>

          <StitchVueIcon name="navigation-back" className={styles.icon} />

        </button>

        <button type="button" className={styles.iconButton} aria-label={t("topNav.forwardAria")} disabled={!canForward} onClick={onForward}>

          <StitchVueIcon name="navigation-forward" className={styles.icon} />

        </button>

        <button type="button" className={styles.iconButton} aria-label={t("topNav.upAria")} disabled={!canUp} onClick={onUp}>

          <StitchVueIcon name="navigation-up" className={styles.icon} />

        </button>

        <Tooltip text={t("common.copyPath")}>

          <button

            type="button"

            className={styles.iconButton}

            aria-label={t("common.copyPathAria")}

            aria-pressed={pathCopied}

            disabled={!path}

            onClick={onCopyPath}

          >

            <StitchVueIcon name="copy" className={styles.icon} />

          </button>

        </Tooltip>

      </div>



      <Breadcrumbs path={path} onNavigate={onNavigate} onFolderContextMenu={onFolderContextMenu} />



      <div className={styles.actions}>

        <button type="button" className={styles.iconButton} aria-label={t("topNav.openFolderAria")} onClick={onOpenFolder}>

          <StitchVueIcon name="open-folder" className={styles.icon} />

        </button>

        <Tooltip text={pinned ? t("topNav.unpinHint") : t("topNav.pinHint")}>

          <button

            type="button"

            className={styles.iconButton}

            aria-label={pinned ? t("topNav.unpinAria") : t("topNav.pinAria")}

            aria-pressed={pinned}

            onClick={onTogglePin}

          >

            <StitchVueIcon name={pinned ? "unpin" : "pin"} className={styles.icon} />

          </button>

        </Tooltip>

      </div>

    </header>

  );

}

