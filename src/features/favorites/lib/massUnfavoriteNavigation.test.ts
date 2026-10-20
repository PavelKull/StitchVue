import assert from 'node:assert/strict';
import test from 'node:test';
import {
    filterFoldersForOptimisticServiceHide,
    shouldRetainMassUnfavoriteGateOnLoad,
    shouldSkipPostBatchServiceFolderNavigation,
    shouldUseInstantParentNavAfterFavoritesClear,
} from './massUnfavoriteNavigation.ts';

const hide = {
    operationId: 'op-1',
    folderPath: 'C:\\Album\\Избранное',
    parentDirectory: 'C:\\Album',
};

test('T01 retain gate only for parent load during background batch', () => {
    assert.equal(
        shouldRetainMassUnfavoriteGateOnLoad({
            targetPath: 'C:\\Album',
            gateSessionId: 'op-1',
            hide,
            backgroundUnfavorite: true,
            optimisticParentNav: null,
        }),
        true,
    );
    assert.equal(
        shouldRetainMassUnfavoriteGateOnLoad({
            targetPath: 'C:\\Other',
            gateSessionId: 'op-1',
            hide,
            backgroundUnfavorite: true,
            optimisticParentNav: null,
        }),
        false,
    );
    assert.equal(
        shouldRetainMassUnfavoriteGateOnLoad({
            targetPath: 'C:\\Album',
            gateSessionId: 'op-2',
            hide,
            backgroundUnfavorite: true,
            optimisticParentNav: null,
        }),
        false,
    );
    assert.equal(
        shouldRetainMassUnfavoriteGateOnLoad({
            targetPath: 'C:\\Album',
            gateSessionId: 'op-1',
            hide,
            backgroundUnfavorite: false,
            optimisticParentNav: null,
        }),
        false,
    );
    assert.equal(
        shouldRetainMassUnfavoriteGateOnLoad({
            targetPath: 'C:\\Album',
            gateSessionId: 'op-1',
            hide,
            backgroundUnfavorite: false,
            optimisticParentNav: {
                sessionId: 'op-1',
                parentDirectory: 'C:\\Album',
            },
        }),
        true,
    );
});

test('T14 hot cache folders strip favorites tile', () => {
    const folders = [
        { name: 'Избранное', path: hide.folderPath, kind: 'folder' as const },
        { name: 'Sub', path: 'C:\\Album\\Sub', kind: 'folder' as const },
    ];
    const filtered = filterFoldersForOptimisticServiceHide(
        folders,
        hide,
        'C:\\Album',
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.path, 'C:\\Album\\Sub');
});

test('T04 skip duplicate navigation after optimistic parent landing', () => {
    assert.equal(
        shouldSkipPostBatchServiceFolderNavigation({
            navigateLocation: {
                folderPath: hide.folderPath,
                parentDirectory: hide.parentDirectory,
            },
            currentPath: 'C:\\Album',
            batchSessionId: 'op-1',
            optimisticParentNav: {
                sessionId: 'op-1',
                parentDirectory: 'C:\\Album',
            },
        }),
        true,
    );
    assert.equal(
        shouldSkipPostBatchServiceFolderNavigation({
            navigateLocation: {
                folderPath: hide.folderPath,
                parentDirectory: hide.parentDirectory,
            },
            currentPath: 'C:\\Album\\Избранное',
            batchSessionId: 'op-1',
            optimisticParentNav: {
                sessionId: 'op-1',
                parentDirectory: 'C:\\Album',
            },
        }),
        false,
    );
});

test('instant parent nav when hide matches removed favorites folder', () => {
    assert.equal(
        shouldUseInstantParentNavAfterFavoritesClear({
            currentPath: hide.folderPath,
            removedFolderPath: hide.folderPath,
            hide,
        }),
        true,
    );
    assert.equal(
        shouldUseInstantParentNavAfterFavoritesClear({
            currentPath: 'C:\\Album',
            removedFolderPath: hide.folderPath,
            hide,
        }),
        false,
    );
});
