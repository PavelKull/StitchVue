import test from 'node:test';
import assert from 'node:assert/strict';
import { insertServiceFolder } from './insertServiceFolder.ts';
import type { FolderShortcut } from '../../entities/folder/types.ts';
import { pathKey } from '../selection/selection.ts';

const folder = (
    name: string,
    path: string,
    serviceRole: FolderShortcut['serviceRole'] = null,
): FolderShortcut => ({
    name,
    path,
    kind: 'folder',
    serviceRole,
});

test('insertServiceFolder adds service folder and orders display', () => {
    const base = [folder('Photos', 'C:\\x\\Photos')];
    const next = insertServiceFolder(
        base,
        'C:\\x\\StitchVue Favorites',
        'favorites',
    );
    assert.ok(next.some((f) => f.serviceRole === 'favorites'));
    assert.equal(
        next.filter((f) => f.serviceRole === 'favorites').length,
        1,
    );
});

test('insertServiceFolder replaces duplicate role', () => {
    const base = [
        folder('Old', 'C:\\a\\fav', 'favorites'),
        folder('Photos', 'C:\\x\\Photos'),
    ];
    const next = insertServiceFolder(base, 'C:\\b\\fav', 'favorites');
    assert.equal(
        next.filter((f) => f.serviceRole === 'favorites').length,
        1,
    );
    assert.ok(next.some((f) => pathKey(f.path) === pathKey('C:\\b\\fav')));
});
