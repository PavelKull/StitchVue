import test from 'node:test';
import assert from 'node:assert/strict';
import {
    pipelineStatsApplyToSession,
    resolveFolderThumbnailsPending,
} from './useGalleryThumbProgress.ts';

test('pipeline stats ignored when request id does not match thumb session', () => {
    assert.equal(pipelineStatsApplyToSession(2, 1), false);
    assert.equal(pipelineStatsApplyToSession(3, 3), true);
});

test('resolveFolderThumbnailsPending delegates to folder pending rules', () => {
    assert.equal(
        resolveFolderThumbnailsPending({
            listingBusy: false,
            imageCount: 0,
            settledCount: 0,
            pipelinePending: null,
            pipelinePass: null,
            cacheCapped: false,
        }),
        false,
    );
    assert.equal(
        resolveFolderThumbnailsPending({
            listingBusy: true,
            imageCount: 10,
            settledCount: 0,
            pipelinePending: null,
            pipelinePass: null,
            cacheCapped: false,
        }),
        true,
    );
});
