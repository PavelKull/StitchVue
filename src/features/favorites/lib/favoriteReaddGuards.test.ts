import assert from 'node:assert/strict';
import test from 'node:test';

import {
    filterMassUnfavoriteStarOverlayEntries,
    shouldPreserveFavoritePathDuringMassUnfavorite,
} from './favoriteReaddGuards.ts';

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
