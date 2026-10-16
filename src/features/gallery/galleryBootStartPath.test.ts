import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGalleryBootStartPath } from './galleryBootStartPath.ts';

test('boot start path skips when remember last folder is off', async () => {
    const result = await resolveGalleryBootStartPath(false, 'C:\\pics', async () => true);
    assert.equal(result.startPath, null);
    assert.equal(result.noticeKey, null);
});

test('boot start path uses accessible last folder', async () => {
    const result = await resolveGalleryBootStartPath(
        true,
        'D:\\album',
        async (path) => path === 'D:\\album',
    );
    assert.equal(result.startPath, 'D:\\album');
    assert.equal(result.noticeKey, null);
});

test('boot start path notices unavailable folder', async () => {
    const result = await resolveGalleryBootStartPath(
        true,
        'Z:\\missing',
        async () => false,
    );
    assert.equal(result.startPath, null);
    assert.equal(result.noticeKey, 'gallery.bootLastFolderUnavailable');
});

test('boot start path notices failed accessibility check', async () => {
    const result = await resolveGalleryBootStartPath(true, 'C:\\x', async () => {
        throw new Error('ipc');
    });
    assert.equal(result.startPath, null);
    assert.equal(result.noticeKey, 'gallery.bootLastFolderFailed');
});
