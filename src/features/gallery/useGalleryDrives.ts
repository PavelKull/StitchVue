import { useCallback, useRef, useState } from 'react';
import {
    applyDrivesSnapshot,
    initialDrivesState,
    shouldRefreshDrives,
    type DrivesState,
} from '../folder/drivesState';
import type { FolderShortcut } from '../../entities/folder/types';
import { listDrives } from '../folder/listDrives';

export function useGalleryDrives() {
    const [drivesState, setDrivesState] = useState<DrivesState>(() =>
        initialDrivesState(),
    );
    const drivesStateRef = useRef(drivesState);
    drivesStateRef.current = drivesState;
    const drivesRequestRef = useRef(0);
    const refreshDrivesRef = useRef<(force?: boolean) => void>(() => undefined);

    const refreshDrives = useCallback((force = false) => {
        if (!force && !shouldRefreshDrives(drivesStateRef.current)) {
            return;
        }
        const id = drivesRequestRef.current + 1;
        drivesRequestRef.current = id;
        const loading: DrivesState = {
            ...drivesStateRef.current,
            status: 'loading',
            error: null,
            requestId: id,
        };
        drivesStateRef.current = loading;
        setDrivesState(loading);
        void listDrives()
            .then((drives) => {
                if (id !== drivesRequestRef.current) {
                    return;
                }
                const next: DrivesState = {
                    status: 'success',
                    drives,
                    error: null,
                    requestId: id,
                };
                drivesStateRef.current = next;
                setDrivesState(next);
            })
            .catch((err: unknown) => {
                if (id !== drivesRequestRef.current) {
                    return;
                }
                const next: DrivesState = {
                    ...drivesStateRef.current,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err),
                    requestId: id,
                };
                drivesStateRef.current = next;
                setDrivesState(next);
            });
    }, []);
    refreshDrivesRef.current = refreshDrives;

    const abandonInFlightDriveRequests = useCallback(() => {
        drivesRequestRef.current += 1;
    }, []);

    const applyHomeDrivesSnapshot = useCallback((drives: FolderShortcut[]) => {
        setDrivesState((current) => {
            const applied = applyDrivesSnapshot(current, drives);
            drivesStateRef.current = applied;
            return applied;
        });
    }, []);

    return {
        drivesState,
        drivesStateRef,
        refreshDrives,
        refreshDrivesRef,
        abandonInFlightDriveRequests,
        applyHomeDrivesSnapshot,
    };
}
