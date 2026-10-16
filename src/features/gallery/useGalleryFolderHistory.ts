import { useCallback, useRef, useState } from 'react';
import {
    appendFolderHistory,
    initialFolderHistory,
    stepFolderHistory,
    type FolderHistory,
} from './galleryFolderHistory.ts';

export function useGalleryFolderHistory(
    load: (path: string | null, record?: boolean) => void | Promise<void>,
) {
    const [history, setHistory] = useState<FolderHistory>(initialFolderHistory);
    const historyRef = useRef<FolderHistory>(initialFolderHistory());

    const recordHistory = useCallback((path: string | null) => {
        const next = appendFolderHistory(historyRef.current, path);
        if (!next) {
            return;
        }
        historyRef.current = next;
        setHistory(next);
    }, []);

    const goHistory = useCallback(
        (delta: number) => {
            const stepped = stepFolderHistory(historyRef.current, delta);
            if (!stepped) {
                return;
            }
            historyRef.current = stepped.history;
            setHistory(stepped.history);
            void load(stepped.path, false);
        },
        [load],
    );

    const applyHistory = useCallback((next: FolderHistory) => {
        historyRef.current = next;
        setHistory(next);
    }, []);

    return {
        history,
        historyRef,
        recordHistory,
        goHistory,
        applyHistory,
    };
}
