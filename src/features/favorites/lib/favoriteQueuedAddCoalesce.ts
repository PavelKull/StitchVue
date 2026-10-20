import { pathKey } from '../../selection/lib/selection.ts';
import type { FavoriteAddIntent } from './favoritesOperationCoordinator.ts';

function albumScopeKey(directory: string): string {
    return pathKey(directory).toLowerCase();
}

/** P2 v1: увеличивать только после замеров на HDD (RAW). */
export const QUEUED_FAVORITE_ADD_CHUNK_SIZE = 16;

/**
 * Берёт префикс очереди (уже отсортированный по sequence) одного albumDirectory.
 */
export function coalesceQueuedFavoriteIntents(
    ordered: readonly FavoriteAddIntent[],
    maxChunk: number = QUEUED_FAVORITE_ADD_CHUNK_SIZE,
): FavoriteAddIntent[] {
    if (ordered.length === 0 || maxChunk <= 0) {
        return [];
    }
    const albumKey = albumScopeKey(ordered[0].albumDirectory);
    const chunk: FavoriteAddIntent[] = [];
    const seenKeys = new Set<string>();
    for (const intent of ordered) {
        if (chunk.length >= maxChunk) {
            break;
        }
        if (albumScopeKey(intent.albumDirectory) !== albumKey) {
            break;
        }
        if (seenKeys.has(intent.photoKey)) {
            continue;
        }
        seenKeys.add(intent.photoKey);
        chunk.push(intent);
    }
    return chunk;
}
