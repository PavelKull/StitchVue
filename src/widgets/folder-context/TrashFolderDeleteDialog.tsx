import { useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import { describeLocalTrashFolder, recycleLocalTrashFolder, type LocalTrashFolderSnapshot } from "../../features/trash/trashApi";

import type { ServiceFolderLocation } from "../../features/selection/fileOperation";

import { formatInvokeError, localizeErrorCode } from "../../shared/i18n";

import { useAnimatedModal } from "../../shared/ui/useAnimatedModal";

import styles from "../selection-actions/SelectionActions.module.scss";



type TrashFolderDeleteDialogProps = {

  folderPath: string | null;

  onCancel: () => void;

  onRecycled: (removed: ServiceFolderLocation | null | undefined) => void;

  onError: (message: string) => void;

};



export function TrashFolderDeleteDialog({ folderPath, onCancel, onRecycled, onError }: TrashFolderDeleteDialogProps) {

  const { t } = useTranslation();

  const open = folderPath !== null;

  const { mounted, phase } = useAnimatedModal(open);

  const cancelRef = useRef<HTMLButtonElement>(null);

  const [loading, setLoading] = useState(false);

  const [confirming, setConfirming] = useState(false);

  const [snapshot, setSnapshot] = useState<LocalTrashFolderSnapshot | null>(null);

  const [loadError, setLoadError] = useState("");



  useEffect(() => {

    if (!folderPath) {

      setSnapshot(null);

      setLoadError("");

      setLoading(false);

      setConfirming(false);

      return;

    }

    let alive = true;

    setLoading(true);

    setLoadError("");

    void describeLocalTrashFolder(folderPath)

      .then((value) => {

        if (!alive) {

          return;

        }

        setSnapshot(value);

        setLoading(false);

      })

      .catch((error: unknown) => {

        if (!alive) {

          return;

        }

        setLoadError(formatInvokeError(error));

        setLoading(false);

      });

    return () => {

      alive = false;

    };

  }, [folderPath]);



  useEffect(() => {

    if (open) {

      cancelRef.current?.focus({ preventScroll: true });

    }

  }, [open, loading]);



  if (!mounted || !folderPath) {

    return null;

  }



  const countsReady = snapshot && !loading && !loadError;

  const showPhotoCount = countsReady && snapshot.photoCount > 0;

  const showOtherFileCount = countsReady && snapshot.otherFileCount > 0;

  const showStats = showPhotoCount || showOtherFileCount;



  return (

    <div className={styles.backdrop} data-modal-phase={phase} role="presentation" onClick={onCancel}>

      <div

        className={styles.dialog}

        data-modal-phase={phase}

        role="dialog"

        aria-modal="true"

        aria-labelledby="trash-folder-delete-title"

        onClick={(event) => event.stopPropagation()}

      >

        <p id="trash-folder-delete-title" className={styles.dialogText}>

          {t("trash.recycleFolderTitle")}

        </p>

        <p className={styles.dialogSubtext}>{t("trash.recycleFolderBody")}</p>

        {loading ? <p className={styles.dialogSubtext}>{t("common.loading")}</p> : null}

        {loadError ? <p className={styles.dialogSubtext}>{loadError}</p> : null}

        {showStats ? (

          <ul className={styles.dialogList}>

            {showPhotoCount ? (

              <li>{t("trash.recycleFolderPhotos", { count: snapshot.photoCount })}</li>

            ) : null}

            {showOtherFileCount ? (

              <li>{t("trash.recycleFolderOtherFiles", { count: snapshot.otherFileCount })}</li>

            ) : null}

          </ul>

        ) : null}

        <div className={styles.dialogActions}>

          <button ref={cancelRef} type="button" className={styles.dialogButton} onClick={onCancel}>

            {t("common.cancel")}

          </button>

          <button

            type="button"

            className={styles.dialogPrimary}

            disabled={!countsReady || confirming}

            onClick={() => {

              if (!snapshot) {

                return;

              }

              setConfirming(true);

              void recycleLocalTrashFolder(folderPath, snapshot.stateToken)

                .then((result) => {

                  onRecycled(result.removedServiceFolder ?? undefined);

                  onCancel();

                })

                .catch((error: unknown) => {

                  const raw = error instanceof Error ? error.message : String(error);

                  const localized = formatInvokeError(error);

                  if (raw.trim() === "state_changed") {

                    void describeLocalTrashFolder(folderPath)

                      .then((fresh) => {

                        setSnapshot(fresh);

                        onError(localizeErrorCode("state_changed"));

                      })

                      .catch(() => onError(localized));

                  } else {

                    onError(localized);

                  }

                })

                .finally(() => setConfirming(false));

            }}

          >

            {t("trash.recycleFolderConfirm")}

          </button>

        </div>

      </div>

    </div>

  );

}

