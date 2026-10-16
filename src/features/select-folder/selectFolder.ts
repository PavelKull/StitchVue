import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DirectoryView } from "../../entities/folder/types";
import i18n from "../../shared/i18n/i18n.ts";

export async function selectFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: i18n.t("topNav.openFolderDialogTitle"),
  });

  if (selected === null) {
    return null;
  }
  if (Array.isArray(selected)) {
    return selected[0] ?? null;
  }
  return selected;
}

export function browseDirectory(path: string | null, session: number): Promise<DirectoryView> {
  return invoke<DirectoryView>("browse_directory", { path, session });
}
