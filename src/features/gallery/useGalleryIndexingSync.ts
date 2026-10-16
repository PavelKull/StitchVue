import { useEffect, useRef, type RefObject } from 'react';
import type { ImageFile, ImageMeta } from '../../entities/image/types';
import { listingHasTrustedGeometry } from './galleryGeometryGate';
import { GEOMETRY_FIRST_WAIT_MS } from '../../widgets/gallery-grid/layout';
import { reorderIndexing, startIndexing } from './api/galleryIndexingApi';
import { samePathList, samePathSet } from './indexingPathEquality';

export type UseGalleryIndexingSyncOptions = {
    geometryPending: boolean;
    folderPath: string | null;
    orderedImages: ImageFile[];
    metaVersion: number;
    failedVersion: number;
    requestId: RefObject<number>;
    indexedPathsRef: RefObject<string[]>;
    metaRef: RefObject<Map<string, ImageMeta>>;
    failedRef: RefObject<Map<string, string>>;
    reportGeometryRange: (fileCount: number) => void;
};

export function useGalleryIndexingSync({
    geometryPending,
    folderPath,
    orderedImages,
    metaVersion,
    failedVersion,
    requestId,
    indexedPathsRef,
    metaRef,
    failedRef,
    reportGeometryRange,
}: UseGalleryIndexingSyncOptions) {
    const geometryNudgeSessionRef = useRef(0);

    useEffect(() => {
        if (!geometryPending || !folderPath) {
            return;
        }
        const session = requestId.current;
        const folder = folderPath;
        const files = orderedImages;
        if (geometryNudgeSessionRef.current === session) {
            return;
        }
        const timer = window.setTimeout(() => {
            if (requestId.current !== session) {
                return;
            }
            if (
                listingHasTrustedGeometry(
                    files,
                    metaRef.current,
                    failedRef.current,
                )
            ) {
                return;
            }
            if (geometryNudgeSessionRef.current === session) {
                return;
            }
            geometryNudgeSessionRef.current = session;
            indexedPathsRef.current = files.map((file) => file.path);
            void startIndexing(folder, files, session);
            reportGeometryRange(files.length);
        }, GEOMETRY_FIRST_WAIT_MS);
        return () => window.clearTimeout(timer);
    }, [
        geometryPending,
        folderPath,
        orderedImages,
        metaVersion,
        failedVersion,
        requestId,
        indexedPathsRef,
        metaRef,
        failedRef,
    ]);

    useEffect(() => {
        const folder = folderPath;
        if (!folder || orderedImages.length === 0) {
            return;
        }
        const paths = orderedImages.map((file) => file.path);
        if (
            samePathList(indexedPathsRef.current, paths) ||
            !samePathSet(indexedPathsRef.current, paths)
        ) {
            return;
        }
        indexedPathsRef.current = paths;
        void reorderIndexing(orderedImages);
    }, [folderPath, orderedImages, indexedPathsRef]);
}
