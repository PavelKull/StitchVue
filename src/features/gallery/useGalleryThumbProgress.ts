import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';
import type { ImageFile, ThumbInfo } from '../../entities/image/types';
import { pathKey } from '../selection/lib/selection.ts';
import {
    folderThumbnailsPending as computeFolderThumbnailsPending,
    markThumbSettled,
    seedSettledThumbKeys,
} from './lib/thumbnails/folderThumbnailsPending.ts';
import { fetchPipelineStats } from './api/pipelineStats.ts';

export type FolderThumbProgressInputs = {
    listingBusy: boolean;
    imageCount: number;
    settledCount: number;
    pipelinePending: number | null;
    pipelinePass: string | null;
    cacheCapped: boolean;
};

export function resolveFolderThumbnailsPending(
    inputs: FolderThumbProgressInputs,
): boolean {
    return computeFolderThumbnailsPending({
        listingBusy: inputs.listingBusy,
        imageCount: inputs.imageCount,
        settledCount: inputs.settledCount,
        pipelinePending: inputs.pipelinePending,
        pipelinePass: inputs.pipelinePass,
        cacheCapped: inputs.cacheCapped,
    });
}

export function pipelineStatsApplyToSession(
    liveRequestId: number,
    thumbProgressSession: number,
): boolean {
    return liveRequestId === thumbProgressSession;
}

const THUMB_STATS_POLL_MS = 500;

export function useGalleryThumbProgress(options: {
    requestId: RefObject<number>;
    folderListingBusy: boolean;
    folderListingBusyRef: RefObject<boolean>;
    thumbsRef: RefObject<Map<string, ThumbInfo>>;
    failedRef: RefObject<Map<string, string>>;
}) {
    const { requestId, folderListingBusy, folderListingBusyRef, thumbsRef, failedRef } =
        options;

    const [folderThumbnailsPending, setFolderThumbnailsPending] =
        useState(true);
    const thumbSettledRef = useRef(new Set<string>());
    const thumbExpectedRef = useRef(new Set<string>());
    const thumbTotalRef = useRef(0);
    const thumbProgressSessionRef = useRef(0);
    const pipelinePassRef = useRef<string | null>(null);
    const pipelinePendingRef = useRef<number | null>(null);
    const cacheCappedRef = useRef(false);

    const syncFolderThumbnailsPending = useCallback(() => {
        const next = resolveFolderThumbnailsPending({
            listingBusy: folderListingBusyRef.current,
            imageCount: thumbTotalRef.current,
            settledCount: thumbSettledRef.current.size,
            pipelinePending: pipelinePendingRef.current,
            pipelinePass: pipelinePassRef.current,
            cacheCapped: cacheCappedRef.current,
        });
        setFolderThumbnailsPending((current) =>
            current === next ? current : next,
        );
    }, [folderListingBusyRef]);

    const beginFolderThumbProgress = useCallback((session: number) => {
        thumbProgressSessionRef.current = session;
        thumbSettledRef.current = new Set();
        thumbExpectedRef.current = new Set();
        thumbTotalRef.current = 0;
        pipelinePassRef.current = null;
        pipelinePendingRef.current = null;
        cacheCappedRef.current = false;
        setFolderThumbnailsPending(true);
    }, []);

    const seedFolderThumbProgress = useCallback(
        (session: number, images: readonly ImageFile[]) => {
            if (session !== thumbProgressSessionRef.current) {
                return;
            }
            thumbTotalRef.current = images.length;
            thumbExpectedRef.current = new Set(
                images.map((image) => pathKey(image.path)),
            );
            thumbSettledRef.current = seedSettledThumbKeys(
                images,
                thumbsRef.current,
                failedRef.current,
            );
            syncFolderThumbnailsPending();
        },
        [failedRef, syncFolderThumbnailsPending, thumbsRef],
    );

    const noteFolderThumbSettled = useCallback(
        (path: string, session: number) => {
            if (session !== thumbProgressSessionRef.current) {
                return;
            }
            const key = pathKey(path);
            if (!thumbExpectedRef.current.has(key)) {
                return;
            }
            if (!markThumbSettled(thumbSettledRef.current, path)) {
                return;
            }
            syncFolderThumbnailsPending();
        },
        [syncFolderThumbnailsPending],
    );

    const noteBaseThumbReadyRef = useRef(noteFolderThumbSettled);
    noteBaseThumbReadyRef.current = noteFolderThumbSettled;
    const noteThumbFailedRef = useRef(noteFolderThumbSettled);
    noteThumbFailedRef.current = noteFolderThumbSettled;

    const folderThumbsLoading = folderListingBusy || folderThumbnailsPending;

    useEffect(() => {
        if (!folderThumbsLoading) {
            return;
        }
        let cancelled = false;
        const poll = async () => {
            try {
                const stats = await fetchPipelineStats();
                if (
                    cancelled ||
                    !pipelineStatsApplyToSession(
                        requestId.current,
                        thumbProgressSessionRef.current,
                    )
                ) {
                    return;
                }
                pipelinePassRef.current = stats.pass;
                pipelinePendingRef.current = stats.pending;
                cacheCappedRef.current = stats.cacheCapped;
                syncFolderThumbnailsPending();
            } catch {
                // Stats are advisory; local settled counters remain the primary path.
            }
        };
        void poll();
        const timer = window.setInterval(() => void poll(), THUMB_STATS_POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [folderThumbsLoading, requestId, syncFolderThumbnailsPending]);

    return {
        folderThumbnailsPending,
        folderThumbsLoading,
        beginFolderThumbProgress,
        seedFolderThumbProgress,
        syncFolderThumbnailsPending,
        noteBaseThumbReadyRef,
        noteThumbFailedRef,
    };
}
