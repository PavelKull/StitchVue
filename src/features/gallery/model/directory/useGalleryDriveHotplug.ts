import { listen } from '@tauri-apps/api/event';
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { DirectoryView, FolderShortcut } from '../../../../entities/folder/types';
import { withLocalizedDirectory } from '../../lib/directory/galleryDirectoryView';
import { browseDirectory } from '../../../select-folder/lib/selectFolder';

export type UseGalleryDriveHotplugOptions = {
    viewRef: MutableRefObject<DirectoryView>;
    requestId: MutableRefObject<number>;
    refreshDrivesRef: MutableRefObject<(force?: boolean) => void>;
    setView: Dispatch<SetStateAction<DirectoryView>>;
    applyHomeDrivesSnapshot: (drives: FolderShortcut[]) => void;
};

/** Re-list home drives when the OS reports attach/eject (Windows logical-drive mask). */
export function useGalleryDriveHotplug({
    viewRef,
    requestId,
    refreshDrivesRef,
    setView,
    applyHomeDrivesSnapshot,
}: UseGalleryDriveHotplugOptions) {
    useEffect(() => {
        let cancelled = false;

        async function refreshHomeListing() {
            if (viewRef.current.path !== null) {
                return;
            }
            const id = requestId.current;
            try {
                const next = await browseDirectory(null, id);
                if (cancelled || requestId.current !== id) {
                    return;
                }
                if (viewRef.current.path !== null) {
                    return;
                }
                setView(withLocalizedDirectory(next));
                applyHomeDrivesSnapshot(
                    next.folders.filter((folder) => folder.kind === 'drive'),
                );
            } catch {
                // Ignore transient browse errors during eject.
            }
        }

        function onDrivesChanged() {
            refreshDrivesRef.current(true);
            void refreshHomeListing();
        }

        const unlisten = listen('drives-changed', onDrivesChanged);

        const onWindowFocus = () => {
            if (viewRef.current.path !== null) {
                return;
            }
            refreshDrivesRef.current(true);
            void refreshHomeListing();
        };
        window.addEventListener('focus', onWindowFocus);

        return () => {
            cancelled = true;
            window.removeEventListener('focus', onWindowFocus);
            void unlisten.then(
                (stop) => stop(),
                () => undefined,
            );
        };
    }, [viewRef, requestId, refreshDrivesRef, setView, applyHomeDrivesSnapshot]);
}
