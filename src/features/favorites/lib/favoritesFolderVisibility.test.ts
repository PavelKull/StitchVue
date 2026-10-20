import assert from 'node:assert/strict';
import test from 'node:test';

import type { FolderShortcut } from '../../../entities/folder/types.ts';
import { pathKey } from '../../selection/lib/selection.ts';
import {
    buildAlbumFolderTiles,
    predictFavoritesServiceFolderPath,
    resolveFavoritesFolderVisibility,
} from './favoritesFolderVisibility.ts';

const parent = 'C:\\Album';
const favPath = 'C:\\Album\\Избранное';

function favoritesFolder(path = favPath): FolderShortcut {
    return {
        name: 'Избранное',
        path,
        kind: 'folder',
        serviceRole: 'favorites',
    };
}

test('mass unfavorite hide yields hidden until add intent revives pending-create', () => {
    const hidden = new Set([pathKey(favPath)]);
    assert.equal(
        resolveFavoritesFolderVisibility({
            albumDirectory: parent,
            pendingCreate: null,
            hiddenFolderKeys: hidden,
            folders: [favoritesFolder()],
            hasActiveFavoriteAdds: false,
        }),
        'hidden',
    );
    assert.equal(
        resolveFavoritesFolderVisibility({
            albumDirectory: parent,
            pendingCreate: null,
            hiddenFolderKeys: hidden,
            folders: [favoritesFolder()],
            hasActiveFavoriteAdds: true,
        }),
        'pending-create',
    );
});

test('pending-create injects favorites tile when listing has no folder', () => {
    const tiles = buildAlbumFolderTiles({
        folders: [{ name: 'Sub', path: 'C:\\Album\\Sub', kind: 'folder' }],
        visibility: 'pending-create',
        pendingCreate: { parentDirectory: parent, folderPath: favPath },
        albumDirectory: parent,
    });
    assert.equal(
        tiles.some((folder) => folder.serviceRole === 'favorites'),
        true,
    );
});

test('predictFavoritesServiceFolderPath prefers hide overlay path', () => {
    assert.equal(
        predictFavoritesServiceFolderPath(parent, {
            operationId: 's1',
            generation: 1,
            folderPath: 'C:\\Album\\CustomFav',
            parentDirectory: parent,
        }),
        'C:\\Album\\CustomFav',
    );
});
