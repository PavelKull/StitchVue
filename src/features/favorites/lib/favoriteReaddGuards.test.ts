import assert from 'node:assert/strict';
import test from 'node:test';

import {
    filterMassUnfavoriteStarOverlayEntries,
    isFavoriteAddIntentExecuting,
    shouldPreserveFavoritePathDuringMassUnfavorite,
} from './favoriteReaddGuards.ts';
import type { FavoriteAddIntent } from './favoritesOperationCoordinator.ts';

test('preserve path when pending add overlay wins over mass unfavorite', () => {
    const overlay = new Map([
        [
            'k1',
            {
                operationId: 'add',
                status: 'pending' as const,
                desired: true,
                generation: 2,
            },
        ],
    ]);
    assert.equal(
        shouldPreserveFavoritePathDuringMassUnfavorite('k1', overlay, []),
        true,
    );
    const filtered = filterMassUnfavoriteStarOverlayEntries(overlay, [
        { key: 'k1', desired: false },
    ]);
    assert.equal(filtered.length, 0);
});

test('executing add intent blocks unfavorite toggle (P5)', () => {
    const intents: FavoriteAddIntent[] = [
        {
            intentId: 'i1',
            photoKey: 'k1',
            photoPath: 'C:\\a.jpg',
            albumDirectory: 'C:\\album',
            overlayOperationId: 'op1',
            desired: true,
            status: 'executing',
            sequence: 1,
            revision: 1,
        },
    ];
    assert.equal(isFavoriteAddIntentExecuting(intents, 'k1'), true);
    assert.equal(isFavoriteAddIntentExecuting(intents, 'k2'), false);
});
