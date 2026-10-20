import { pathKey } from '../../selection/lib/selection.ts';
import type { FolderShortcut } from '../../../entities/folder/types.ts';

export type OptimisticFavoritesFolderHide = {
    operationId: string;
    folderPath: string;
    parentDirectory: string;
};

export type MassUnfavoriteOptimisticParentNav = {
    sessionId: string;
    parentDirectory: string;
};

/** Keep unfavorite gate + hide while loading the parent during an in-flight mass unfavorite. */
export function shouldRetainMassUnfavoriteGateOnLoad(options: {
    targetPath: string | null;
    gateSessionId: string | null | undefined;
    hide: OptimisticFavoritesFolderHide | null;
    backgroundUnfavorite: boolean;
    optimisticParentNav: MassUnfavoriteOptimisticParentNav | null;
}): boolean {
    if (!options.targetPath || !options.gateSessionId || !options.hide) {
        return false;
    }
    if (options.hide.operationId !== options.gateSessionId) {
        return false;
    }
    const sessionInFlight =
        options.backgroundUnfavorite ||
        (options.optimisticParentNav !== null &&
            options.optimisticParentNav.sessionId === options.gateSessionId);
    if (!sessionInFlight) {
        return false;
    }
    return (
        pathKey(options.targetPath) ===
        pathKey(options.hide.parentDirectory)
    );
}

export function filterFoldersForOptimisticServiceHide(
    folders: readonly FolderShortcut[],
    hide: OptimisticFavoritesFolderHide | null,
    directoryPath: string,
): FolderShortcut[] {
    if (
        !hide ||
        pathKey(directoryPath) !== pathKey(hide.parentDirectory)
    ) {
        return [...folders];
    }
    const hiddenKey = pathKey(hide.folderPath);
    return folders.filter((folder) => pathKey(folder.path) !== hiddenKey);
}

/** Reconciliation must not re-run folder-exit navigation when user already landed on parent. */
export function shouldSkipPostBatchServiceFolderNavigation(options: {
    navigateLocation: { folderPath: string; parentDirectory: string } | null;
    currentPath: string | null;
    batchSessionId: string;
    optimisticParentNav: MassUnfavoriteOptimisticParentNav | null;
}): boolean {
    const nav = options.navigateLocation;
    if (!nav || !options.currentPath) {
        return false;
    }
    if (
        pathKey(options.currentPath) === pathKey(nav.folderPath)
    ) {
        return false;
    }
    if (
        pathKey(options.currentPath) !== pathKey(nav.parentDirectory)
    ) {
        return false;
    }
    const optimistic = options.optimisticParentNav;
    return (
        optimistic !== null &&
        optimistic.sessionId === options.batchSessionId &&
        pathKey(optimistic.parentDirectory) === pathKey(nav.parentDirectory)
    );
}

export function shouldUseInstantParentNavAfterFavoritesClear(options: {
    currentPath: string | null;
    removedFolderPath: string;
    hide: OptimisticFavoritesFolderHide | null;
}): boolean {
    if (!options.currentPath || !options.hide) {
        return false;
    }
    return (
        pathKey(options.currentPath) === pathKey(options.removedFolderPath) &&
        pathKey(options.hide.folderPath) === pathKey(options.removedFolderPath)
    );
}
