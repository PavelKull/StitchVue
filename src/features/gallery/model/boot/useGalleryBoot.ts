import { invoke } from '@tauri-apps/api/core';
import { useEffect, type RefObject } from 'react';
import type { OperationNotice } from '../../../selection/lib/fileOperation';
import { bootToastNotice } from '../../../../shared/ui/noticeChannels';
import type { DeferredVoid } from '../../lib/viewport/galleryGeometryGate';
import { resolveGalleryBootStartPath } from '../../lib/boot/galleryBootStartPath';
import { loadGallerySessionMemory } from '../../../settings/lib/gallerySessionMemory';
import { loadPreferences } from '../../../settings/lib/settingsPreferences';

export type UseGalleryBootOptions = {
    refreshUsage: () => void;
    refreshDrives: (force?: boolean) => void;
    load: (path: string | null) => void | Promise<void>;
    pipelineListenersReady: RefObject<DeferredVoid>;
    /** C-002 toast channel (OperationNoticeView), not a separate boot strip. */
    showGalleryToast: (notice: OperationNotice) => void;
    translate: (key: string) => string;
    abandonInFlightDriveRequests: () => void;
};

export function useGalleryBoot({
    refreshUsage,
    refreshDrives,
    load,
    pipelineListenersReady,
    showGalleryToast,
    translate,
    abandonInFlightDriveRequests,
}: UseGalleryBootOptions) {
    useEffect(() => {
        let cancelled = false;
        async function bootstrap() {
            refreshUsage();
            void invoke('set_storage_profile', { mode: 'auto' }).catch(
                () => undefined,
            );
            const prefs = loadPreferences();
            const memory = loadGallerySessionMemory();
            const { startPath, noticeKey } = await resolveGalleryBootStartPath(
                prefs.rememberLastFolder,
                memory.lastFolderPath,
                (path) =>
                    invoke<boolean>('directory_accessible', { path }),
            );
            if (!cancelled && noticeKey) {
                showGalleryToast(bootToastNotice(translate(noticeKey)));
            }
            await pipelineListenersReady.current.promise;
            if (!cancelled) {
                refreshDrives(true);
                void load(startPath);
            }
        }
        void bootstrap();
        return () => {
            cancelled = true;
            abandonInFlightDriveRequests();
        };
    }, [
        refreshUsage,
        refreshDrives,
        load,
        pipelineListenersReady,
        showGalleryToast,
        translate,
        abandonInFlightDriveRequests,
    ]);
}
