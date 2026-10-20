/**
 * Безопасная очистка пустой служебной папки «Избранное» после add-intent
 * (отмена / полный провал), когда на диске осталась только `.stitchvue.role`.
 */
export function shouldAttemptEmptyFavoritesCleanup(options: {
    parentDirectory: string | null;
    serviceRole: 'favorites' | 'trash' | null | undefined;
    hasActiveAddIntents: boolean;
    copyToFavoritesInFlight: boolean;
}): boolean {
    if (!options.parentDirectory || options.serviceRole != null) {
        return false;
    }
    if (options.hasActiveAddIntents || options.copyToFavoritesInFlight) {
        return false;
    }
    return true;
}
