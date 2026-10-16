import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ImageFile } from '../../entities/image/types.ts';
import { indexPayload } from './galleryIndexPayload.ts';

test('indexPayload returns empty array for no files', () => {
    assert.deepEqual(indexPayload([]), []);
});

test('indexPayload maps path, size, modifiedAt', () => {
    const files: ImageFile[] = [
        {
            path: 'C:\\photos\\a.jpg',
            name: 'a.jpg',
            size: 1024,
            modifiedAt: 1_700_000_000,
        },
    ];
    assert.deepEqual(indexPayload(files), [
        {
            path: 'C:\\photos\\a.jpg',
            size: 1024,
            modifiedAt: 1_700_000_000,
        },
    ]);
});
