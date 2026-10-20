import assert from 'node:assert/strict';
import test from 'node:test';
import type { FavoriteAddIntent } from './favoritesOperationCoordinator.ts';
import {
    coalesceQueuedFavoriteIntents,
    QUEUED_FAVORITE_ADD_CHUNK_SIZE,
} from './favoriteQueuedAddCoalesce.ts';

function intent(
    photoKey: string,
    sequence: number,
    albumDirectory = 'C:\\Album',
): FavoriteAddIntent {
    return {
        intentId: `i-${sequence}`,
        photoKey,
        photoPath: `C:\\Album\\${photoKey}`,
        albumDirectory,
        desired: true,
        status: 'queued',
        revision: 1,
        sequence,
        overlayOperationId: `o-${sequence}`,
    };
}

test('T20 coalesce preserves FIFO and caps chunk size', () => {
    const ordered = [
        intent('a', 1),
        intent('b', 2),
        intent('c', 3),
    ];
    const chunk = coalesceQueuedFavoriteIntents(ordered, 2);
    assert.equal(chunk.length, 2);
    assert.equal(chunk[0].photoKey, 'a');
    assert.equal(chunk[1].photoKey, 'b');
});

test('T20 coalesce dedupes duplicate photoKey', () => {
    const ordered = [intent('a', 1), intent('a', 2), intent('b', 3)];
    const chunk = coalesceQueuedFavoriteIntents(ordered, 16);
    assert.equal(chunk.length, 2);
    assert.deepEqual(chunk.map((i) => i.photoKey), ['a', 'b']);
});

test('T20 coalesce stops at album boundary', () => {
    const ordered = [
        intent('a', 1, 'C:\\AlbumA'),
        intent('b', 2, 'C:\\AlbumB'),
    ];
    const chunk = coalesceQueuedFavoriteIntents(ordered, 16);
    assert.equal(chunk.length, 1);
    assert.equal(chunk[0].photoKey, 'a');
});

test('T20 default chunk size is 16', () => {
    assert.equal(QUEUED_FAVORITE_ADD_CHUNK_SIZE, 16);
});
