import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    appendFolderHistory,
    initialFolderHistory,
    stepFolderHistory,
} from './galleryFolderHistory.ts';

test('appendFolderHistory skips duplicate tail', () => {
    const base = initialFolderHistory();
    const first = appendFolderHistory(base, 'C:\\a');
    assert.ok(first);
    assert.equal(appendFolderHistory(first!, 'C:\\a'), null);
});

test('stepFolderHistory navigates back and forward', () => {
    let h = initialFolderHistory();
    h = appendFolderHistory(h, 'C:\\a')!;
    h = appendFolderHistory(h, 'C:\\b')!;
    const back = stepFolderHistory(h, -1);
    assert.equal(back?.path, 'C:\\a');
    const forward = stepFolderHistory(back!.history, 1);
    assert.equal(forward?.path, 'C:\\b');
});
