import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLBAR_PEEK_HIDE_DELAY_MS } from './useGalleryPanelPeek.ts';

test('toolbar peek hide delay matches GalleryPage contract', () => {
    assert.equal(TOOLBAR_PEEK_HIDE_DELAY_MS, 400);
});
