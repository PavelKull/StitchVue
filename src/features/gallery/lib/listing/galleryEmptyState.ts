import type { ServiceRole } from '../../../../entities/folder/serviceFolder.ts';

export type GalleryEmptyKind =
    | 'none'
    | 'opening'
    | 'openError'
    | 'emptyFolder'
    | 'noSupportedFiles'
    | 'subfoldersOnly'
    | 'emptyFavorites'
    | 'emptyTrash';

export type GalleryEmptyStateInput = {
    status: string;
    folderListingBusy: boolean;
    geometryPending: boolean;
    serviceRole: ServiceRole | null | undefined;
    imageCount: number;
    folderCount: number;
    unsupportedFileCount: number;
    /** Mass unfavorite navigates away — do not flash «пустое Избранное». */
    optimisticLeavingFavorites?: boolean;
};

export function resolveGalleryEmptyKind(
    input: GalleryEmptyStateInput,
): GalleryEmptyKind {
    if (input.status === 'error') {
        return 'openError';
    }
    if (input.status !== 'ready') {
        return 'opening';
    }
    if (input.imageCount > 0) {
        if (input.geometryPending) {
            return 'opening';
        }
        return 'none';
    }
    if (input.folderListingBusy || input.geometryPending) {
        return 'opening';
    }
    if (input.serviceRole === 'favorites') {
        if (input.optimisticLeavingFavorites) {
            return 'none';
        }
        return 'emptyFavorites';
    }
    if (input.serviceRole === 'trash') {
        return 'emptyTrash';
    }
    if (input.folderCount > 0) {
        return 'none';
    }
    if (input.unsupportedFileCount > 0) {
        return 'noSupportedFiles';
    }
    return 'emptyFolder';
}

export function galleryEmptyI18nKeys(
    kind: GalleryEmptyKind,
): { titleKey: string; descriptionKey: string } | null {
    if (kind === 'none') {
        return null;
    }
    return {
        titleKey: `gallery.${kind}.title`,
        descriptionKey: `gallery.${kind}.description`,
    };
}
