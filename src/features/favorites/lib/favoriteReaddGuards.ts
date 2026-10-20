import type { FavoriteAddIntent } from './favoritesOperationCoordinator.ts';
import type { FavoriteOverlayMap } from './favoriteOptimisticOverlay.ts';

/** Mass-unfavorite must not downgrade a star the user already re-marked as favorite. */
export function hasPendingFavoriteAddOverlay(
    overlay: FavoriteOverlayMap,
    photoKey: string,
): boolean {
    const entry = overlay.get(photoKey);
    return entry?.status === 'pending' && entry.desired === true;
}

export function hasActiveFavoriteAddIntent(
    intents: readonly FavoriteAddIntent[],
    photoKey: string,
): boolean {
    const intent = intents.find((item) => item.photoKey === photoKey);
    if (!intent?.desired) {
        return false;
    }
    return intent.status === 'queued' || intent.status === 'executing';
}

export function shouldPreserveFavoritePathDuringMassUnfavorite(
    photoKey: string,
    overlay: FavoriteOverlayMap,
    intents: readonly FavoriteAddIntent[],
): boolean {
    return (
        hasPendingFavoriteAddOverlay(overlay, photoKey) ||
        hasActiveFavoriteAddIntent(intents, photoKey)
    );
}

export function filterMassUnfavoriteStarOverlayEntries<
    T extends { key: string; desired: boolean },
>(overlay: FavoriteOverlayMap, entries: readonly T[]): T[] {
    return entries.filter((entry) => {
        if (entry.desired) {
            return true;
        }
        return !hasPendingFavoriteAddOverlay(overlay, entry.key);
    });
}
