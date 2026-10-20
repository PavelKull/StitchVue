import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeScrollJumpState,
    emptyScrollJumpState,
    scrollJumpStatesEqual,
} from './galleryScrollJump.ts';

test('empty scroll jump state', () => {
    assert.deepEqual(emptyScrollJumpState(), {
        canScroll: false,
        pointUp: false,
    });
});

test('canScroll when content exceeds viewport', () => {
    assert.deepEqual(
        computeScrollJumpState({
            scrollHeight: 1000,
            clientHeight: 500,
            scrollTop: 0,
        }),
        { canScroll: true, pointUp: false },
    );
    assert.deepEqual(
        computeScrollJumpState({
            scrollHeight: 500,
            clientHeight: 500,
            scrollTop: 0,
        }),
        { canScroll: false, pointUp: false },
    );
    assert.deepEqual(
        computeScrollJumpState({
            scrollHeight: 501,
            clientHeight: 500,
            scrollTop: 0,
        }),
        { canScroll: true, pointUp: false },
    );
});

test('pointUp when scrollTop > clientHeight', () => {
    assert.deepEqual(
        computeScrollJumpState({
            scrollHeight: 2000,
            clientHeight: 500,
            scrollTop: 501,
        }),
        { canScroll: true, pointUp: true },
    );
    assert.deepEqual(
        computeScrollJumpState({
            scrollHeight: 2000,
            clientHeight: 500,
            scrollTop: 500,
        }),
        { canScroll: true, pointUp: false },
    );
});

test('scrollJumpStatesEqual', () => {
    assert.equal(
        scrollJumpStatesEqual(
            { canScroll: true, pointUp: false },
            { canScroll: true, pointUp: false },
        ),
        true,
    );
    assert.equal(
        scrollJumpStatesEqual(
            { canScroll: true, pointUp: true },
            { canScroll: true, pointUp: false },
        ),
        false,
    );
});
