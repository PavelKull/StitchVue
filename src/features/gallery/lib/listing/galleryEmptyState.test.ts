import assert from 'node:assert/strict';
import test from 'node:test';
import {
    galleryEmptyI18nKeys,
    resolveGalleryEmptyKind,
    type GalleryEmptyKind,
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

test('T3 only subfolders — subfoldersOnly', () => {
    assert.equal(
        resolveGalleryEmptyKind(base({ folderCount: 2 })),
        'subfoldersOnly',
    );
});

test('T4 unsupported files with subfolders — subfoldersOnly', () => {
    assert.equal(
        resolveGalleryEmptyKind(
            base({ unsupportedFileCount: 1, folderCount: 1 }),
        ),
        'subfoldersOnly',
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

test('T8 scanning or listing busy shows opening', () => {
    assert.equal(
        resolveGalleryEmptyKind(base({ status: 'scanning' })),
        'opening',
    );
    assert.equal(
        resolveGalleryEmptyKind(base({ folderListingBusy: true })),
        'opening',
    );
    assert.equal(
        resolveGalleryEmptyKind(base({ geometryPending: true })),
        'opening',
    );
});

test('T9 error state is openError', () => {
    assert.equal(
        resolveGalleryEmptyKind(base({ status: 'error' })),
        'openError',
    );
});

test('T11 geometryPending with images still opening', () => {
    assert.equal(
        resolveGalleryEmptyKind(
            base({ imageCount: 3, geometryPending: true }),
        ),
        'opening',
    );
});

test('empty favorites and trash kinds', () => {
    assert.equal(
        resolveGalleryEmptyKind(base({ serviceRole: 'favorites' })),
        'emptyFavorites',
    );
    assert.equal(
        resolveGalleryEmptyKind(base({ serviceRole: 'trash' })),
        'emptyTrash',
    );
    assert.equal(
        resolveGalleryEmptyKind(
            base({ serviceRole: 'favorites', imageCount: 2 }),
        ),
        'none',
    );
    assert.equal(
        resolveGalleryEmptyKind(base({ serviceRole: 'trash', imageCount: 1 })),
        'none',
    );
});

test('i18n keys for each empty kind', () => {
    const kinds: GalleryEmptyKind[] = [
        'opening',
        'openError',
        'emptyFolder',
        'noSupportedFiles',
        'subfoldersOnly',
        'emptyFavorites',
        'emptyTrash',
    ];
    for (const kind of kinds) {
        assert.deepEqual(galleryEmptyI18nKeys(kind), {
            titleKey: `gallery.${kind}.title`,
            descriptionKey: `gallery.${kind}.description`,
        });
    }
    assert.equal(galleryEmptyI18nKeys('none'), null);
});
