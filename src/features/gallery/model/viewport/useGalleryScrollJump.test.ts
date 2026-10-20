import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeScrollJumpState,
    isAtScrollBottom,
    scrollJumpStatesEqual,
    scrollMax,
    shouldClearPendingScrollToEnd,
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
        }),
        false,
    );
});
