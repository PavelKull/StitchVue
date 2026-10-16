import test from 'node:test';
import assert from 'node:assert/strict';
import {
    initialScrollModeState,
    SCROLL_IDLE_MS,
} from '../../lib/viewport/scrollLoadMode.ts';
import {
    clearScrollActivityTimer,
    scrollActivityStateAfterFolderReset,
    scrollModeUpdateFromSample,
} from './useGalleryScrollActivity.ts';

test('burst scroll invokes IPC only when mode or ahead changes', () => {
    let state = initialScrollModeState();
    const ipc: string[] = [];
    let t = 1000;
    const samples = [
        { top: 0, prev: 0 },
        { top: 50, prev: 0 },
        { top: 120, prev: 50 },
        { top: 125, prev: 120 },
    ];
    for (const { top, prev } of samples) {
        const { next, ipcChanged } = scrollModeUpdateFromSample(
            state,
            top,
            prev,
            t,
        );
        if (ipcChanged) {
            ipc.push(`${next.mode}:${next.ahead}`);
        }
        state = next;
        t += 16;
    }
    assert.ok(ipc.length >= 1);
    assert.ok(ipc.length < samples.length);
});

test('idle timer contract uses SCROLL_IDLE_MS', () => {
    assert.equal(SCROLL_IDLE_MS, 200);
});

test('folder reset returns initial scroll mode', () => {
    let state = initialScrollModeState();
    const { next } = scrollModeUpdateFromSample(state, 100, 0, 1000);
    state = next;
    assert.notEqual(state.mode, 'idle');
    state = initialScrollModeState();
    assert.equal(state.mode, 'idle');
    assert.equal(state.ahead, 0);
});

test('scrolling resumes after idle reset state', () => {
    let state = initialScrollModeState();
    const first = scrollModeUpdateFromSample(state, 80, 0, 1000);
    state = first.next;
    state = initialScrollModeState();
    const second = scrollModeUpdateFromSample(state, 40, 0, 3000);
    assert.equal(second.ipcChanged, true);
    assert.equal(second.next.mode, 'scrolling');
});

test('clearScrollActivityTimer clears pending id (unmount/reset contract)', () => {
    let cleared = 0;
    const original = globalThis.clearTimeout;
    globalThis.clearTimeout = (id) => {
        cleared = id as number;
    };
    const timerRef = { current: 42 };
    clearScrollActivityTimer(timerRef);
    assert.equal(cleared, 42);
    assert.equal(timerRef.current, 0);
    globalThis.clearTimeout = original;
});

test('scrollActivityStateAfterFolderReset matches initial mode', () => {
    const reset = scrollActivityStateAfterFolderReset();
    assert.equal(reset.mode, 'idle');
    assert.equal(reset.ahead, 0);
    let state = scrollModeUpdateFromSample(reset, 100, 0, 1000);
    assert.equal(state.ipcChanged, true);
    assert.equal(state.next.mode, 'scrolling');
});
