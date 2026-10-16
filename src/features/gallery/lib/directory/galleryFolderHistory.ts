export type FolderHistory = {
    index: number;
    entries: (string | null)[];
};

export function initialFolderHistory(): FolderHistory {
    return { index: 0, entries: [null] };
}

export function appendFolderHistory(
    current: FolderHistory,
    path: string | null,
): FolderHistory | null {
    const entries = current.entries.slice(0, current.index + 1);
    if (entries[entries.length - 1] === path) {
        return null;
    }
    entries.push(path);
    return { index: entries.length - 1, entries };
}

export function stepFolderHistory(
    current: FolderHistory,
    delta: number,
): { history: FolderHistory; path: string | null } | null {
    const index = current.index + delta;
    if (index < 0 || index >= current.entries.length) {
        return null;
    }
    return {
        history: { index, entries: current.entries },
        path: current.entries[index] ?? null,
    };
}
