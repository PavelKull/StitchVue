import type { FolderKind, FolderShortcut } from "../../../entities/folder/types";

/** Rename/delete IPC допустим только для вложенной папки, не для корня диска. */
export function canLoadFolderMenuOptions(
  folder: Pick<FolderShortcut, "kind">,
  parentDirectory: string,
): boolean {
  if (folder.kind === "drive") {
    return false;
  }
  return parentDirectory.trim().length > 0;
}

export function folderShortcutFromPath(path: string): FolderShortcut {
  const normalized = path.replace(/\//g, "\\").replace(/\\+$/, "");
  const drive = /^([A-Za-z]:)$/.exec(normalized);
  if (drive) {
    return { name: drive[1], path: `${drive[1]}\\`, kind: "drive" };
  }
  const slash = normalized.lastIndexOf("\\");
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const kind: FolderKind = "folder";
  return { name, path, kind };
}
