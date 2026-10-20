import { DISK_SERVICE_FOLDER_LEAF } from '../../../entities/folder/serviceFolder.ts';
import type { FolderShortcut } from '../../../entities/folder/types.ts';
import { pathKey } from '../../selection/lib/selection.ts';
import { orderFoldersForDisplay } from '../../folder/lib/folderOrder.ts';
import { insertServiceFolder } from '../../folder/lib/insertServiceFolder.ts';
import type { FavoritesServiceFolderHideOverlay } from './favoriteMassUnfavoriteOptimistic.ts';

export type FavoritesFolderVisibility = 'visible' | 'hidden' | 'pending-create';

export type FavoritesFolderPendingCreate = {
    parentDirectory: string;
    folderPath: string;
};

export function predictFavoritesServiceFolderPath(
    parentDirectory: string,
    hideOverlay: FavoritesServiceFolderHideOverlay | null,
): string {
    if (
        hideOverlay &&
        pathKey(hideOverlay.parentDirectory) === pathKey(parentDirectory)
    ) {
        return hideOverlay.folderPath;
    }
    const base = parentDirectory.replace(/[\\/]+$/, '');
    const sep = base.includes('/') ? '/' : '\\';
    return `${base}${sep}${DISK_SERVICE_FOLDER_LEAF.favorites}`;
}

export function resolveFavoritesFolderVisibility(options: {
    albumDirectory: string;
    pendingCreate: FavoritesFolderPendingCreate | null;
    hiddenFolderKeys: ReadonlySet<string>;
    folders: readonly FolderShortcut[];
    hasActiveFavoriteAdds: boolean;
}): FavoritesFolderVisibility {
    const albumKey = pathKey(options.albumDirectory);
    const favoritesFolder = options.folders.find(
        (folder) => folder.serviceRole === 'favorites',
    );
    const pendingForAlbum =
        options.pendingCreate &&
        pathKey(options.pendingCreate.parentDirectory) === albumKey;
    // Плейсхолдер, пока листинг ещё без «Избранное». Зависший pendingCreate
    // не должен блокировать уже существующую плитку после cancel или смены папки.
    if (!favoritesFolder && (options.hasActiveFavoriteAdds || pendingForAlbum)) {
        return 'pending-create';
    }
    if (
        favoritesFolder &&
        options.hiddenFolderKeys.has(pathKey(favoritesFolder.path))
    ) {
        if (options.hasActiveFavoriteAdds) {
            return 'pending-create';
        }
        return 'hidden';
    }
    return 'visible';
}

export function nextFavoritesFolderPendingCreate(options: {
    parentDirectory: string | null;
    serviceRole?: 'favorites' | 'trash' | null;
    folders: readonly FolderShortcut[];
    hasActiveAddIntents: boolean;
    copyInFlightForParent: boolean;
    hideOverlay: FavoritesServiceFolderHideOverlay | null;
}): FavoritesFolderPendingCreate | null {
    if (!options.parentDirectory || options.serviceRole) {
        return null;
    }
    const hasFolder = options.folders.some(
        (folder) => folder.serviceRole === 'favorites',
    );
    if (
        (options.hasActiveAddIntents || options.copyInFlightForParent) &&
        !hasFolder
    ) {
        return {
            parentDirectory: options.parentDirectory,
            folderPath: predictFavoritesServiceFolderPath(
                options.parentDirectory,
                options.hideOverlay,
            ),
        };
    }
    return null;
}

export function buildAlbumFolderTiles(options: {
    folders: readonly FolderShortcut[];
    visibility: FavoritesFolderVisibility;
    pendingCreate: FavoritesFolderPendingCreate | null;
    albumDirectory: string;
}): FolderShortcut[] {
    const albumKey = pathKey(options.albumDirectory);
    let tiles = orderFoldersForDisplay([...options.folders]);
    const favoritesFolder = tiles.find(
        (folder) => folder.serviceRole === 'favorites',
    );

    if (options.visibility === 'hidden' && favoritesFolder) {
        const hiddenKey = pathKey(favoritesFolder.path);
        tiles = tiles.filter(
            (folder) => pathKey(folder.path) !== hiddenKey,
        );
        return tiles;
    }

    if (options.visibility === 'pending-create') {
        const placeholderPath =
            options.pendingCreate &&
            pathKey(options.pendingCreate.parentDirectory) === albumKey
                ? options.pendingCreate.folderPath
                : favoritesFolder?.path ??
                  predictFavoritesServiceFolderPath(
                      options.albumDirectory,
                      null,
                  );
        if (!favoritesFolder) {
            tiles = insertServiceFolder(tiles, placeholderPath, 'favorites');
        } else {
            const hiddenKey = pathKey(favoritesFolder.path);
            tiles = tiles.filter(
                (folder) => pathKey(folder.path) !== hiddenKey,
            );
            tiles = insertServiceFolder(tiles, placeholderPath, 'favorites');
        }
    }

    return tiles;
}

export function favoritesFolderTileIsPendingCreate(
    folder: FolderShortcut,
    visibility: FavoritesFolderVisibility,
    pendingCreate: FavoritesFolderPendingCreate | null,
    albumDirectory: string,
): boolean {
    if (visibility !== 'pending-create' || folder.serviceRole !== 'favorites') {
        return false;
    }
    if (!pendingCreate) {
        return true;
    }
    return (
        pathKey(pendingCreate.parentDirectory) === pathKey(albumDirectory) &&
        pathKey(folder.path) === pathKey(pendingCreate.folderPath)
    );
}
