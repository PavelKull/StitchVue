import { invoke } from '@tauri-apps/api/core';

export function beginDirectorySession(
    session: number,
    folder: string | null,
): Promise<void> {
    return invoke('begin_directory_session', { session, folder });
}
