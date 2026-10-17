import assert from 'node:assert/strict';
import test from 'node:test';
import {
    galleryEmptyI18nKeys,
    resolveGalleryEmptyKind,
    type GalleryEmptyStateInput,
} from './galleryEmptyState.ts';

function base(
    patch: Partial<GalleryEmptyStateInput> = {},
): GalleryEmptyStateInput {
    return {
        status: 'ready',
        folderListingBusy: false,
        geometryPending: false,
        serviceRole: null,
        imageCount: 0,
        folderCount: 0,
        unsupportedFileCount: 0,
        ...patch,
    };
}

test('T1 nothing in folder', () => {
    assert.equal(resolveGalleryEmptyKind(base()), 'emptyFolder');
});

test('T2 only unsupported files', () => {
    assert.equal(
        resolveGalleryEmptyKind(base({ unsupportedFileCount: 2 })),
        'noSupportedFiles',
    );
});

test('T3 only subfolders — no center warning', () => {
    assert.equal(resolveGalleryEmptyKind(base({ folderCount: 2 })), 'none');
});

test('T4 unsupported files with subfolders — no center warning', () => {
    assert.equal(
        resolveGalleryEmptyKind(
            base({ unsupportedFileCount: 1, folderCount: 1 }),
        ),
        'none',
    );
});

test('T5 one jpeg shows gallery', () => {
    assert.equal(resolveGalleryEmptyKind(base({ imageCount: 1 })), 'none');
});

test('T6 jpeg and txt shows gallery', () => {
    assert.equal(
        resolveGalleryEmptyKind(
            base({ imageCount: 1, unsupportedFileCount: 1 }),
        ),
        'none',
    );
});

test('T7 supported raw/heic counts as gallery', () => {
    assert.equal(resolveGalleryEmptyKind(base({ imageCount: 1 })), 'none');
});

test('T8 scanning or listing busy hides empty state', () => {
    assert.equal(
        resolveGalleryEmptyKind(base({ status: 'scanning' })),
        'none',
    );
    assert.equal(
        resolveGalleryEmptyKind(base({ folderListingBusy: true })),
        'none',
    );
    assert.equal(
        resolveGalleryEmptyKind(base({ geometryPending: true })),
        'none',
    );
});

test('T9 error state is not empty folder', () => {
    assert.equal(
        resolveGalleryEmptyKind(base({ status: 'error' })),
        'none',
    );
});

test('T11 thumbs pending does not imply empty when images exist', () => {
    assert.equal(
        resolveGalleryEmptyKind(
            base({ imageCount: 3, geometryPending: true }),
        ),
        'none',
    );
});

test('i18n keys for each empty kind', () => {
    assert.deepEqual(galleryEmptyI18nKeys('emptyFolder'), {
        titleKey: 'gallery.emptyFolder.title',
        descriptionKey: 'gallery.emptyFolder.description',
    });
    assert.deepEqual(galleryEmptyI18nKeys('noSupportedFiles'), {
        titleKey: 'gallery.noSupportedFiles.title',
        descriptionKey: 'gallery.noSupportedFiles.description',
    });
    assert.equal(galleryEmptyI18nKeys('none'), null);
});
