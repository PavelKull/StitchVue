export type GalleryBootNoticeKey =
    | 'gallery.bootLastFolderUnavailable'
    | 'gallery.bootLastFolderFailed';

export type GalleryBootStartPathResult = {
    startPath: string | null;
    noticeKey: GalleryBootNoticeKey | null;
};

/**
 * Resolves the folder to open on app boot from preferences + session memory.
 * IPC accessibility check is injected so tests stay pure.
 */
export async function resolveGalleryBootStartPath(
    rememberLastFolder: boolean,
    lastFolderPath: string | null | undefined,
    isDirectoryAccessible: (path: string) => Promise<boolean>,
): Promise<GalleryBootStartPathResult> {
    if (!rememberLastFolder || !lastFolderPath) {
        return { startPath: null, noticeKey: null };
    }
    try {
        const ok = await isDirectoryAccessible(lastFolderPath);
        if (ok) {
            return { startPath: lastFolderPath, noticeKey: null };
        }
        return {
            startPath: null,
            noticeKey: 'gallery.bootLastFolderUnavailable',
        };
    } catch {
        return { startPath: null, noticeKey: 'gallery.bootLastFolderFailed' };
    }
}
