import { invoke } from "@tauri-apps/api/core";
import type { RecycleItemResult } from "../selection/lib/fileOperation";

export type LocalTrashFolderSnapshot = {
  photoCount: number;
  otherFileCount: number;
  subdirectoryCount: number;
  stateToken: string;
};

export async function describeLocalTrashFolder(path: string): Promise<LocalTrashFolderSnapshot> {
  return invoke<LocalTrashFolderSnapshot>("describe_local_trash_folder", { path });
}

export async function recycleLocalTrashFolder(path: string, stateToken: string): Promise<RecycleItemResult> {
  return invoke<RecycleItemResult>("recycle_local_trash_folder", { path, stateToken });
}

export async function recycleLocalTrashFile(path: string): Promise<RecycleItemResult> {
  return invoke<RecycleItemResult>("recycle_local_trash_file", { path });
}

export async function trashEntryOrigin(path: string): Promise<string | null> {
  const value = await invoke<string | null>("trash_entry_origin", { path });
  return value ?? null;
}
