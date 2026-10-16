import { useCallback, useState, type MouseEvent } from "react";

import type { FolderShortcut } from "../../entities/folder/types";

import { loadFolderMenuOptions, removeEmptyServiceFolder, renameFolder } from "../../features/folder/lib/folderMenu";

import type { ServiceFolderLocation } from "../../features/selection/lib/fileOperation";

import { formatInvokeError } from "../../shared/i18n";

import { FolderContextMenu, type FolderContextTarget } from "./FolderContextMenu";

import { RenameFolderDialog } from "./RenameFolderDialog";

import { TrashFolderDeleteDialog } from "./TrashFolderDeleteDialog";



export type FolderRenamedEvent = {
  parentDirectory: string;
  oldPath: string;
  newPath: string;
  newName: string;
  serviceRole: FolderShortcut["serviceRole"];
};

type UseFolderContextMenuOptions = {

  onRenamed?: (event: FolderRenamedEvent) => void;

  onRemovedServiceFolder?: (removed: ServiceFolderLocation) => void;

  onError?: (message: string) => void;

};



export function useFolderContextMenu({ onRenamed, onRemovedServiceFolder, onError }: UseFolderContextMenuOptions) {

  const [menu, setMenu] = useState<FolderContextTarget | null>(null);

  const [renameTarget, setRenameTarget] = useState<FolderContextTarget | null>(null);

  const [recycleTrashPath, setRecycleTrashPath] = useState<string | null>(null);



  const reportError = useCallback(

    (error: unknown) => {

      onError?.(formatInvokeError(error));

    },

    [onError],

  );



  const openFolderContextMenu = useCallback(

    (event: MouseEvent, folder: FolderShortcut, parentDirectory: string) => {

      event.preventDefault();

      event.stopPropagation();

      if (folder.kind === "drive" || !parentDirectory) {

        return;

      }

      void loadFolderMenuOptions(parentDirectory, folder.path)

        .then((options) => {

          const hasActions =

            options.canRename || options.canDeleteEmptyService || options.canRecycleTrashFolder;

          if (!hasActions) {

            return;

          }

          setMenu({

            folder,

            parentDirectory,

            x: event.clientX,

            y: event.clientY,

            canDeleteEmptyService: options.canDeleteEmptyService,

            canRecycleTrashFolder: options.canRecycleTrashFolder,

          });

        })

        .catch(reportError);

    },

    [reportError],

  );



  const contextUi = (

    <>

      <FolderContextMenu

        target={menu}

        onClose={() => setMenu(null)}

        onRename={(target) => {

          setMenu(null);

          setRenameTarget(target);

        }}

        onDelete={(target) => {

          setMenu(null);

          void removeEmptyServiceFolder(target.parentDirectory, target.folder.path)

            .then((removed) => onRemovedServiceFolder?.(removed))

            .catch(reportError);

        }}

        onRecycleTrash={(target) => {

          setMenu(null);

          setRecycleTrashPath(target.folder.path);

        }}

      />

      <RenameFolderDialog

        open={renameTarget !== null}

        initialName={renameTarget?.folder.name ?? ""}

        onCancel={() => setRenameTarget(null)}

        onConfirm={(name) => {

          const target = renameTarget;

          if (!target) {

            return;

          }

          setRenameTarget(null);

          void renameFolder(target.parentDirectory, target.folder.path, name)

            .then((newPath) =>
              onRenamed?.({
                parentDirectory: target.parentDirectory,
                oldPath: target.folder.path,
                newPath,
                newName: name,
                serviceRole: target.folder.serviceRole,
              }),
            )

            .catch(reportError);

        }}

      />

      <TrashFolderDeleteDialog

        folderPath={recycleTrashPath}

        onCancel={() => setRecycleTrashPath(null)}

        onRecycled={(removed) => {

          setRecycleTrashPath(null);

          if (removed) {

            onRemovedServiceFolder?.(removed);

          }

        }}

        onError={(message) => onError?.(message)}

      />

    </>

  );



  const folderDialogsOpen = renameTarget !== null || recycleTrashPath !== null;
  const folderContextMenuOpen = menu !== null;

  return { openFolderContextMenu, contextUi, folderDialogsOpen, folderContextMenuOpen };

}


