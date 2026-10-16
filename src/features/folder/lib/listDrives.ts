import { invoke } from "@tauri-apps/api/core";
import type { FolderShortcut } from "../../entities/folder/types";

export function listDrives(): Promise<FolderShortcut[]> {
  return invoke<FolderShortcut[]>("list_drives");
}
