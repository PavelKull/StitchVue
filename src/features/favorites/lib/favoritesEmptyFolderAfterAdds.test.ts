import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAttemptEmptyFavoritesCleanup } from './favoritesEmptyFolderAfterAdds.ts';

test('cleanup skipped while add intents or copy in flight', () => {
    assert.equal(
        shouldAttemptEmptyFavoritesCleanup({
            parentDirectory: 'C:\\Album',
            serviceRole: null,
            hasActiveAddIntents: true,
            copyToFavoritesInFlight: false,
        }),
        false,
    );
    assert.equal(
        shouldAttemptEmptyFavoritesCleanup({
            parentDirectory: 'C:\\Album',
            serviceRole: null,
            hasActiveAddIntents: false,
            copyToFavoritesInFlight: true,
        }),
        false,
    );
});

test('cleanup allowed when album idle', () => {
    assert.equal(
        shouldAttemptEmptyFavoritesCleanup({
            parentDirectory: 'C:\\Album',
            serviceRole: null,
            hasActiveAddIntents: false,
            copyToFavoritesInFlight: false,
        }),
        true,
    );
});

test('cleanup skipped inside favorites folder view', () => {
    assert.equal(
        shouldAttemptEmptyFavoritesCleanup({
            parentDirectory: 'C:\\Album\\Избранное',
            serviceRole: 'favorites',
            hasActiveAddIntents: false,
            copyToFavoritesInFlight: false,
        }),
        false,
    );
});
