import { useCallback, useState, type MouseEvent } from "react";

import type { FolderShortcut } from "../../entities/folder/types";

import { canLoadFolderMenuOptions, folderShortcutFromPath } from "../../features/folder/lib/folderContextMenuAccess";
import {
  loadFolderMenuOptions,
  openFolderInExplorer,
  removeEmptyServiceFolder,
  renameFolder,
} from "../../features/folder/lib/folderMenu";
import { parentDirectoryPath } from "../../features/folder/lib/parentPath";

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

function explorerOnlyTarget(
  folder: FolderShortcut,
  parentDirectory: string,
  x: number,
  y: number,
): FolderContextTarget {
  return {
    folder,
    parentDirectory,
    x,
    y,
    canRename: false,
    canDeleteEmptyService: false,
    canRecycleTrashFolder: false,
  };
}

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
      if (!folder.path) {
        return;
      }
      const x = event.clientX;
      const y = event.clientY;
      if (!canLoadFolderMenuOptions(folder, parentDirectory)) {
        setMenu(explorerOnlyTarget(folder, parentDirectory, x, y));
        return;
      }
      void loadFolderMenuOptions(parentDirectory, folder.path)
        .then((options) => {
          setMenu({
            folder,
            parentDirectory,
            x,
            y,
            canRename: options.canRename,
            canDeleteEmptyService: options.canDeleteEmptyService,
            canRecycleTrashFolder: options.canRecycleTrashFolder,
          });
        })
        .catch(() => {
          setMenu(explorerOnlyTarget(folder, parentDirectory, x, y));
        });
    },
    [],
  );

  const openFolderPathContextMenu = useCallback(
    (event: MouseEvent, path: string | null) => {
      if (!path) {
        return;
      }
      const folder = folderShortcutFromPath(path);
      openFolderContextMenu(event, folder, parentDirectoryPath(folder.path));
    },
    [openFolderContextMenu],
  );

  const contextUi = (
    <>
      <FolderContextMenu
        target={menu}
        onClose={() => setMenu(null)}
        onOpenInExplorer={(target) => {
          setMenu(null);
          void openFolderInExplorer(target.folder.path).catch(reportError);
        }}
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

  return {
    openFolderContextMenu,
    openFolderPathContextMenu,
    contextUi,
    folderDialogsOpen,
    folderContextMenuOpen,
  };
}
