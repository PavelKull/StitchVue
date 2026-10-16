import { invoke } from '@tauri-apps/api/core';
import type { ImageFile } from '../../../entities/image/types';
import { indexPayload } from '../galleryIndexPayload';

export function startIndexing(
    folder: string,
    files: ImageFile[],
    session: number,
): Promise<void> {
    return invoke('start_indexing', {
        folder,
        files: indexPayload(files),
        session,
    });
}

export function reorderIndexing(files: ImageFile[]): Promise<void> {
    return invoke('reorder_indexing', { files: indexPayload(files) });
}
