import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createEmptyView,
    withLocalizedDirectory,
} from './galleryDirectoryView.ts';

test('createEmptyView sets empty listing and null path', () => {
    const view = createEmptyView('Title');
    assert.equal(view.title, 'Title');
    assert.equal(view.path, null);
    assert.equal(view.parent, null);
    assert.deepEqual(view.folders, []);
    assert.deepEqual(view.images, []);
    assert.equal(view.serviceRole, null);
});

test('withLocalizedDirectory localizes this-pc title', async () => {
    const { initI18n } = await import('../../../../shared/i18n/i18n.ts');
    await initI18n();
    const view = {
        title: 'raw',
        path: null,
        parent: null,
        folders: [],
        images: [],
        serviceRole: null,
        placeCode: 'this-pc' as const,
    };
    const next = withLocalizedDirectory(view);
    assert.notEqual(next.title, 'raw');
    assert.equal(next.path, null);
    assert.equal(next.images, view.images);
});

test('withLocalizedDirectory keeps folder title when path set', async () => {
    const { initI18n } = await import('../../../../shared/i18n/i18n.ts');
    await initI18n();
    const view = {
        title: 'Vacation',
        path: 'C:\\pics',
        parent: 'C:\\',
        folders: [],
        images: [],
        serviceRole: null,
    };
    const next = withLocalizedDirectory(view);
    assert.equal(next.title, 'Vacation');
});
