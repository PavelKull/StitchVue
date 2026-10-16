import { invoke } from '@tauri-apps/api/core';
import { useEffect, type RefObject } from 'react';
import type { DeferredVoid } from './galleryGeometryGate';
import { resolveGalleryBootStartPath } from './galleryBootStartPath';
import { loadGallerySessionMemory } from '../settings/gallerySessionMemory';
import { loadPreferences } from '../settings/settingsPreferences';

export type UseGalleryBootOptions = {
    refreshUsage: () => void;
    refreshDrives: (force?: boolean) => void;
    load: (path: string | null) => void | Promise<void>;
    pipelineListenersReady: RefObject<DeferredVoid>;
    setBootNotice: (message: string | null) => void;
    translate: (key: string) => string;
    abandonInFlightDriveRequests: () => void;
};

export function useGalleryBoot({
    refreshUsage,
    refreshDrives,
    load,
    pipelineListenersReady,
    setBootNotice,
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
                setBootNotice(translate(noticeKey));
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
        setBootNotice,
        translate,
        abandonInFlightDriveRequests,
    ]);
}
