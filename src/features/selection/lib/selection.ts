export type SelectionState = {
  directoryKey: string | null;
  paths: string[];
  anchor: string | null;
};

export function emptySelection(directoryKey: string | null): SelectionState {
  return { directoryKey, paths: [], anchor: null };
}

/** Стабильный ключ пути (Windows: снимает префикс `\\?\` у canonicalize). */
export function pathKey(path: string): string {
  let normalized = path.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (normalized.startsWith("\\\\?\\")) {
    normalized = normalized.slice(4);
    if (normalized.toUpperCase().startsWith("UNC\\")) {
      normalized = `\\\\${normalized.slice(4)}`;
    }
  }
  return normalized.toLowerCase();
}

export function folderLeaf(path: string | null): string {
  if (!path) {
    return "";
  }
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function resetDirectory(state: SelectionState, directoryKey: string): SelectionState {
  if (state.directoryKey === directoryKey) {
    return state;
  }
  return emptySelection(directoryKey);
}

export function togglePath(
  state: SelectionState,
  directoryKey: string,
  ordered: readonly string[],
  path: string,
): SelectionState {
  const base = resetDirectory(state, directoryKey);
  if (!ordered.includes(path)) {
    return base;
  }
  const selected = new Set(base.paths);
  if (selected.has(path)) {
    selected.delete(path);
  } else {
    selected.add(path);
  }
  return {
    directoryKey,
    paths: ordered.filter((item) => selected.has(item)),
    anchor: path,
  };
}

export function addRange(
  state: SelectionState,
  directoryKey: string,
  ordered: readonly string[],
  path: string,
): SelectionState {
  const base = resetDirectory(state, directoryKey);
  const target = ordered.indexOf(path);
  if (target < 0) {
    return base;
  }
  const anchorIndex = base.anchor === null ? -1 : ordered.indexOf(base.anchor);
  const selected = new Set(base.paths);
  if (anchorIndex < 0) {
    selected.add(path);
  } else {
    const start = Math.min(anchorIndex, target);
    const end = Math.max(anchorIndex, target);
    for (let index = start; index <= end; index += 1) {
      selected.add(ordered[index]);
    }
  }
  return {
    directoryKey,
    paths: ordered.filter((item) => selected.has(item)),
    // Keep the existing Shift anchor so subsequent Shift+clicks re-range from it.
    anchor: base.anchor ?? path,
  };
}

export function selectAll(
  directoryKey: string,
  ordered: readonly string[],
  anchor: string | null,
): SelectionState {
  return {
    directoryKey,
    paths: [...ordered],
    anchor,
  };
}

export function pruneSelection(
  state: SelectionState,
  directoryKey: string | null,
  ordered: readonly string[],
): SelectionState {
  if (state.directoryKey !== directoryKey) {
    return emptySelection(directoryKey);
  }
  const allowed = new Set(ordered);
  const paths = state.paths.filter((item) => allowed.has(item));
  const anchor = state.anchor !== null && allowed.has(state.anchor) ? state.anchor : null;
  if (paths.length === state.paths.length && anchor === state.anchor) {
    return state;
  }
  return { directoryKey, paths, anchor };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Physical KeyA — layout-independent (RU layout sends key "ф", not "a"). */
export function isSelectAllHotkey(event: {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey?: boolean;
}): boolean {
  return event.code === "KeyA" && event.ctrlKey && !event.shiftKey;
}

/** Ctrl+Shift+A — clear selection; same physical key as select-all. */
export function isClearSelectionHotkey(event: {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey?: boolean;
}): boolean {
  return event.code === "KeyA" && event.ctrlKey && event.shiftKey;
}
