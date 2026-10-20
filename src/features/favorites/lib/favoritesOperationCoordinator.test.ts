import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createFavoritesOperationCoordinator,
    type FavoriteAddDrainResult,
    type FavoriteAddIntent,
    filesystemPathsConflict,
    isTemporaryFilesystemConflictMessage,
    massUnfavoriteAlbumScope,
} from './favoritesOperationCoordinator.ts';

function completeAll(
    intents: readonly FavoriteAddIntent[],
): FavoriteAddDrainResult {
    const results: Record<string, 'completed'> = {};
    for (const item of intents) {
        results[item.photoKey] = 'completed';
    }
    return { kind: 'ok', results };
}

test('T14 ancestor paths conflict like Rust locks', () => {
    assert.equal(
        filesystemPathsConflict(
            'C:\\Album',
            'C:\\Album\\Избранное\\photo.jpg',
        ),
        true,
    );
    assert.equal(
        filesystemPathsConflict('C:\\Album\\a.jpg', 'C:\\Album\\b.jpg'),
        false,
    );
    assert.equal(
        filesystemPathsConflict('D:\\Other', 'C:\\Album'),
        false,
    );
});

test('T13 independent albums stay free', () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.beginMassUnfavorite({
        operationId: 'u1',
        parentDirectory: 'C:\\AlbumA',
        sessionPath: 'C:\\AlbumA\\Избранное',
    });
    assert.equal(
        coordinator.conflictForDirectory('C:\\AlbumB').status,
        'free',
    );
    assert.equal(
        coordinator.conflictForDirectory('C:\\AlbumA').status,
        'busy',
    );
});

test('T01 queued add waits until mass unfavorite ends', async () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.beginMassUnfavorite({
        operationId: 'mass-1',
        parentDirectory: 'C:\\Album',
        sessionPath: 'C:\\Album\\Избранное',
    });
    coordinator.upsertAddIntent({
        intentId: 'i1',
        photoKey: 'c:\\album\\p1.jpg',
        photoPath: 'C:\\Album\\p1.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o1',
        desired: true,
    });
    const executed: string[] = [];
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
        for (const intent of intents) {
            executed.push(intent.photoKey);
        }
        return completeAll(intents);
    });
    assert.equal(executed.length, 0);
    coordinator.endMassUnfavorite('mass-1');
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
        for (const intent of intents) {
            executed.push(intent.photoKey);
        }
        return completeAll(intents);
    });
    assert.deepEqual(executed, ['c:\\album\\p1.jpg']);
});

test('T04 three rapid toggles collapse to one queued intent', () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.beginMassUnfavorite({
        operationId: 'mass-1',
        parentDirectory: 'C:\\Album',
        sessionPath: 'C:\\Album\\Избранное',
    });
    coordinator.upsertAddIntent({
        intentId: 'i1',
        photoKey: 'k1',
        photoPath: 'C:\\Album\\p.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o1',
        desired: true,
    });
    coordinator.upsertAddIntent({
        intentId: 'i2',
        photoKey: 'k1',
        photoPath: 'C:\\Album\\p.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o2',
        desired: false,
    });
    const last = coordinator.upsertAddIntent({
        intentId: 'i3',
        photoKey: 'k1',
        photoPath: 'C:\\Album\\p.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o3',
        desired: true,
    });
    assert.equal(last.desired, true);
    assert.equal(
        coordinator.snapshotIntents().filter((i) => i.status === 'queued').length,
        1,
    );
});

test('T03 double toggle off cancels queued intent', async () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.beginMassUnfavorite({
        operationId: 'mass-1',
        parentDirectory: 'C:\\Album',
        sessionPath: 'C:\\Album\\Избранное',
    });
    coordinator.upsertAddIntent({
        intentId: 'i1',
        photoKey: 'k1',
        photoPath: 'C:\\Album\\p.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o1',
        desired: true,
    });
    coordinator.upsertAddIntent({
        intentId: 'i2',
        photoKey: 'k1',
        photoPath: 'C:\\Album\\p.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o2',
        desired: false,
    });
    coordinator.endMassUnfavorite('mass-1');
    const executed: string[] = [];
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
        for (const intent of intents) {
            executed.push(intent.photoKey);
        }
        return completeAll(intents);
    });
    assert.equal(executed.length, 0);
});

test('T18 finalizing phase still blocks conflicting add', () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.beginMassUnfavorite({
        operationId: 'mass-1',
        parentDirectory: 'C:\\Album',
        sessionPath: 'C:\\Album\\Избранное',
    });
    coordinator.setMassUnfavoritePhase('mass-1', 'finalizing');
    assert.equal(
        coordinator.conflictForDirectory('C:\\Album').status,
        'busy',
    );
});

test('T19 P1: end mass unfavorite during finalizing unblocks queued drain', async () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.beginMassUnfavorite({
        operationId: 'mass-1',
        parentDirectory: 'C:\\Album',
        sessionPath: 'C:\\Album\\Избранное',
    });
    coordinator.setMassUnfavoritePhase('mass-1', 'finalizing');
    coordinator.upsertAddIntent({
        intentId: 'i1',
        photoKey: 'c:\\album\\p1.jpg',
        photoPath: 'C:\\Album\\p1.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o1',
        desired: true,
    });
    assert.equal(
        coordinator.conflictForDirectory('C:\\Album').status,
        'busy',
    );
    const executed: string[] = [];
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
        for (const intent of intents) {
            executed.push(intent.photoKey);
        }
        return completeAll(intents);
    });
    assert.equal(executed.length, 0);
    coordinator.endMassUnfavorite('mass-1');
    assert.equal(
        coordinator.conflictForDirectory('C:\\Album').status,
        'free',
    );
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
        for (const intent of intents) {
            executed.push(intent.photoKey);
        }
        return completeAll(intents);
    });
    assert.deepEqual(executed, ['c:\\album\\p1.jpg']);
});

test('T17 retry at most once on conflict message helper', () => {
    assert.equal(
        isTemporaryFilesystemConflictMessage(
            'Конфликтующая файловая операция уже выполняется',
        ),
        true,
    );
    assert.equal(isTemporaryFilesystemConflictMessage('disk full'), false);
});

test('T11 stale finish does not double drain execution', async () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.upsertAddIntent({
        intentId: 'i1',
        photoKey: 'k1',
        photoPath: 'C:\\Album\\p.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o1',
        desired: true,
    });
    let calls = 0;
    const run = async () => {
        await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
            calls += 1;
            return completeAll(intents);
        });
    };
    await run();
    await run();
    assert.equal(calls, 1);
});

test('massUnfavoriteAlbumScope prefers parent directory', () => {
    assert.equal(
        massUnfavoriteAlbumScope({
            parentDirectory: 'C:\\Album',
            sessionPath: 'C:\\Album\\Избранное',
        }),
        'c:\\album',
    );
});

test('T21 drain batches multiple queued intents in one execute call', async () => {
    const coordinator = createFavoritesOperationCoordinator();
    for (let index = 0; index < 3; index += 1) {
        coordinator.upsertAddIntent({
            intentId: `i${index}`,
            photoKey: `k${index}`,
            photoPath: `C:\\Album\\p${index}.jpg`,
            albumDirectory: 'C:\\Album',
            overlayOperationId: `o${index}`,
            desired: true,
        });
    }
    const batchSizes: number[] = [];
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
        batchSizes.push(intents.length);
        return completeAll(intents);
    });
    assert.deepEqual(batchSizes, [3]);
});

test('T22 partial batch results map to per-intent terminals', async () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.upsertAddIntent({
        intentId: 'i1',
        photoKey: 'ok',
        photoPath: 'C:\\Album\\ok.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o1',
        desired: true,
    });
    coordinator.upsertAddIntent({
        intentId: 'i2',
        photoKey: 'bad',
        photoPath: 'C:\\Album\\bad.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o2',
        desired: true,
    });
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => ({
        kind: 'ok',
        results: {
            ok: 'completed',
            bad: 'failed',
        },
    }));
    assert.equal(coordinator.snapshotIntents().length, 0);
});

test('T23 pre_start_conflict falls back to single-intent execute', async () => {
    const coordinator = createFavoritesOperationCoordinator();
    coordinator.upsertAddIntent({
        intentId: 'i1',
        photoKey: 'k1',
        photoPath: 'C:\\Album\\p1.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o1',
        desired: true,
    });
    coordinator.upsertAddIntent({
        intentId: 'i2',
        photoKey: 'k2',
        photoPath: 'C:\\Album\\p2.jpg',
        albumDirectory: 'C:\\Album',
        overlayOperationId: 'o2',
        desired: true,
    });
    let calls = 0;
    await coordinator.drainQueuedAdds('C:\\Album', async (intents) => {
        calls += 1;
        if (intents.length > 1) {
            return { kind: 'pre_start_conflict' };
        }
        return completeAll(intents);
    });
    assert.equal(calls, 3);
    assert.equal(coordinator.snapshotIntents().length, 0);
});
