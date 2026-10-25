import { emptySelection, type SelectionState } from "./selection.ts";

/** Modifier select, Ctrl+A, and checkbox toggles always enter visual selection mode. */
export function enterSelectionMode(): true {
  return true;
}

/** Escape: clear paths, hide bulk bar, leave selection mode. */
export function escapeSelection(directoryKey: string | null): {
  selectionMode: false;
  selection: SelectionState;
} {
  return {
    selectionMode: false,
    selection: emptySelection(directoryKey),
  };
}

/** Folder change: same full reset as Escape. */
export function resetSelectionOnFolderChange(directoryKey: string | null): {
  selectionMode: false;
  selection: SelectionState;
} {
  return escapeSelection(directoryKey);
}

/** «Снять выделение»: clear paths, keep mode if it was on. */
export function clearSelectionPaths(directoryKey: string | null): SelectionState {
  return emptySelection(directoryKey);
}

/**
 * Toolbar «Выбрать»:
 * - off → on with empty selection (checkmarks available);
 * - on → off and clear paths (no orphan bulk UI).
 */
export function toggleSelectionModeButton(
  currentlyOn: boolean,
  directoryKey: string | null,
): { selectionMode: boolean; selection: SelectionState } {
  if (currentlyOn) {
    return { selectionMode: false, selection: emptySelection(directoryKey) };
  }
  return { selectionMode: true, selection: emptySelection(directoryKey) };
}

/** Bulk bar when any image is selected, independent of how selection was made. */
export function shouldShowSelectionActions(selectedCount: number, hasProgress: boolean): boolean {
  return selectedCount > 0 || hasProgress;
}

/**
 * Parent for mass unfavorite navigation: prefer browse `parent`, else derive from the
 * favorites folder path so a null `view.parent` cannot skip navigation / leave selectionMode on.
 */
export function resolveUnfavoriteParentDirectory(
  viewParent: string | null | undefined,
  favoritesDirectory: string,
): string | null {
  if (viewParent && viewParent.trim()) {
    return viewParent;
  }
  const sep = favoritesDirectory.startsWith("/") ? "/" : "\\";
  const normalized = favoritesDirectory.replace(/[\\/]/g, sep).replace(/[\\/]+$/, "");
  const index = normalized.lastIndexOf(sep);
  if (index <= 0) {
    return null;
  }
  return normalized.slice(0, index);
}

/** Full selection reset when leaving «Избранное» after mass unfavorite (parent or same folder). */
export function selectionAfterMassUnfavorite(directoryKey: string | null): {
  selectionMode: false;
  selection: SelectionState;
} {
  return escapeSelection(directoryKey);
}
