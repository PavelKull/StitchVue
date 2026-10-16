import { invoke } from '@tauri-apps/api/core';

export function clearThumbnailCache(): Promise<void> {
    return invoke('clear_cache');
}
