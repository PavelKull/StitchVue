import type { FolderShortcut } from "../../entities/folder/types";

/** «Избранное» и «Удаленное» в начале; остальные папки — в исходном порядке с бэкенда. */
export function orderFoldersForDisplay(folders: readonly FolderShortcut[]): FolderShortcut[] {
  const favorites: FolderShortcut[] = [];
  const trash: FolderShortcut[] = [];
  const rest: FolderShortcut[] = [];
  for (const folder of folders) {
    if (folder.serviceRole === "favorites") {
      favorites.push(folder);
    } else if (folder.serviceRole === "trash") {
      trash.push(folder);
    } else {
      rest.push(folder);
    }
  }
  return [...favorites, ...trash, ...rest];
}
