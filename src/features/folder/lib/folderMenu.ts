import { invoke } from "@tauri-apps/api/core";
import type { ServiceFolderCleanupResult, ServiceFolderLocation } from "../../selection/lib/fileOperation";

export type FolderMenuOptions = {
  canRename: boolean;
  canDeleteEmptyService: boolean;
  canRecycleTrashFolder: boolean;
};

export async function loadFolderMenuOptions(
  parentDirectory: string,
  folderPath: string,
): Promise<FolderMenuOptions> {
  return invoke<FolderMenuOptions>("folder_menu_options", {
    parentDirectory,
    folderPath,
  });
}

export async function openFolderInExplorer(folderPath: string): Promise<void> {
  await invoke("open_in_explorer", { path: folderPath });
}

export async function renameFolder(
  parentDirectory: string,
  folderPath: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_folder", {
    parentDirectory,
    folderPath,
    newName,
  });
}

export async function removeEmptyServiceFolder(
  parentDirectory: string,
  folderPath: string,
): Promise<ServiceFolderLocation> {
  return invoke<ServiceFolderLocation>("remove_empty_service_folder", { parentDirectory, folderPath });
}

/** Structured cleanup: removed | not_empty | already_gone | failed (does not throw for expected cases). */
export async function cleanupEmptyServiceFolder(
  parentDirectory: string,
  folderPath: string,
): Promise<ServiceFolderCleanupResult> {
  return invoke<ServiceFolderCleanupResult>("cleanup_empty_service_folder", {
    parentDirectory,
    folderPath,
  });
}
