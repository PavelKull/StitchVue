import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeScrollJumpState,
    scrollJumpStatesEqual,
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
