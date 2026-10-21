import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeScrollJumpState,
    isAtScrollBottom,
    scrollJumpAnimationDurationMs,
    SCROLL_JUMP_ANIM_MAX_MS,
    SCROLL_JUMP_ANIM_MIN_MS,
    scrollJumpStatesEqual,
    scrollMax,
    shouldClearPendingScrollToEnd,
    shouldStickFollowScrollGrowth,
} from '../../lib/viewport/galleryScrollJump.ts';

test('commitScrollJump equality matches hook helper', () => {
    const a = computeScrollJumpState({
        scrollHeight: 800,
        clientHeight: 400,
        scrollTop: 100,
    });
    const b = computeScrollJumpState({
        scrollHeight: 800,
        clientHeight: 400,
        scrollTop: 100,
    });
    assert.equal(scrollJumpStatesEqual(a, b), true);
    const c = computeScrollJumpState({
        scrollHeight: 800,
        clientHeight: 400,
        scrollTop: 500,
    });
    assert.equal(scrollJumpStatesEqual(a, c), false);
});

test('scrollJumpAnimationDurationMs is fast and capped', () => {
    assert.equal(scrollJumpAnimationDurationMs(0), SCROLL_JUMP_ANIM_MIN_MS);
    assert.equal(scrollJumpAnimationDurationMs(50), SCROLL_JUMP_ANIM_MIN_MS);
    assert.equal(scrollJumpAnimationDurationMs(10_000), SCROLL_JUMP_ANIM_MAX_MS);
});

test('scrollMax and isAtScrollBottom', () => {
    assert.equal(scrollMax(1000, 400), 600);
    assert.equal(isAtScrollBottom(598, 600), true);
    assert.equal(isAtScrollBottom(500, 600), false);
});

test('shouldClearPendingScrollToEnd on scroll up', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 100,
            previousScrollTop: 200,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: false,
            geometryComplete: false,
            animating: false,
        }),
        true,
    );
});

test('shouldClearPendingScrollToEnd when listing complete at bottom', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 599,
            previousScrollTop: 580,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: true,
            animating: false,
        }),
        true,
    );
});

test('shouldClearPendingScrollToEnd stays while growing toward end', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 300,
            previousScrollTop: 280,
            scrollHeight: 2000,
            clientHeight: 400,
            listingComplete: false,
            geometryComplete: false,
            animating: false,
        }),
        false,
    );
});

test('shouldClearPendingScrollToEnd noop when not pending', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: false,
            scrollTop: 0,
            previousScrollTop: 100,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: true,
            animating: false,
        }),
        false,
    );
});

test('shouldClearPendingScrollToEnd stays when listing complete but geometry incomplete at bottom', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 599,
            previousScrollTop: 599,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: false,
            animating: false,
        }),
        false,
    );
});

test('shouldStickFollowScrollGrowth when height grew', () => {
    assert.equal(
        shouldStickFollowScrollGrowth({
            pending: true,
            animating: false,
            previousHeight: 800,
            scrollHeight: 1200,
        }),
        true,
    );
    assert.equal(
        shouldStickFollowScrollGrowth({
            pending: true,
            animating: true,
            previousHeight: 800,
            scrollHeight: 1200,
        }),
        false,
    );
    assert.equal(
        shouldStickFollowScrollGrowth({
            pending: false,
            animating: false,
            previousHeight: 800,
            scrollHeight: 1200,
        }),
        false,
    );
    assert.equal(
        shouldStickFollowScrollGrowth({
            pending: true,
            animating: false,
            previousHeight: 1200,
            scrollHeight: 1200,
        }),
        false,
    );
});

test('shouldClearPendingScrollToEnd when listing and geometry complete at bottom', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 599,
            previousScrollTop: 599,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: true,
            animating: false,
        }),
        true,
    );
});

test('shouldClearPendingScrollToEnd on user scroll up while geometry incomplete', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 400,
            previousScrollTop: 500,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: false,
            animating: false,
        }),
        true,
    );
});

test('shouldClearPendingScrollToEnd stays while animating at bottom', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 599,
            previousScrollTop: 599,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: true,
            animating: true,
        }),
        false,
    );
});

test('shouldClearPendingScrollToEnd on empty non-scrollable listing', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 0,
            previousScrollTop: 0,
            scrollHeight: 400,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: true,
            animating: false,
        }),
        true,
    );
});

test('shouldClearPendingScrollToEnd stays for programmatic at-bottom while animating with incomplete geometry', () => {
    assert.equal(
        shouldClearPendingScrollToEnd({
            pending: true,
            scrollTop: 599,
            previousScrollTop: 580,
            scrollHeight: 1000,
            clientHeight: 400,
            listingComplete: true,
            geometryComplete: false,
            animating: true,
        }),
        false,
    );
});
