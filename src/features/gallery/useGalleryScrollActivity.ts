import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import {
    advanceScrollMode,
    initialScrollModeState,
    SCROLL_IDLE_MS,
    type ScrollModeState,
} from './scrollLoadMode.ts';
import {
    computeScrollJumpState,
    type ScrollJumpState,
} from './galleryScrollJump.ts';

export type CommitScrollJump = (next: ScrollJumpState) => void;

export type UseGalleryScrollActivityParams = {
    scrollTopRef: MutableRefObject<number>;
    viewportRef: RefObject<HTMLElement | null>;
    commitScrollJump: CommitScrollJump;
};

/** Exported for unit tests (IPC mocked at hook boundary). */
export function scrollModeUpdateFromSample(
    state: ScrollModeState,
    top: number,
    previousTop: number,
    nowMs: number,
): { next: ScrollModeState; ipcChanged: boolean } {
    const next = advanceScrollMode(state, top, previousTop, nowMs);
    const ipcChanged =
        next.mode !== state.mode || next.ahead !== state.ahead;
    return { next, ipcChanged };
}

export function useGalleryScrollActivity({
    scrollTopRef,
    viewportRef,
    commitScrollJump,
}: UseGalleryScrollActivityParams) {
    const scrollTimer = useRef(0);
    const scrollModeRef = useRef<ScrollModeState>(initialScrollModeState());

    useEffect(
        () => () => {
            window.clearTimeout(scrollTimer.current);
            scrollTimer.current = 0;
        },
        [],
    );

    const resetScrollActivityForFolderChange = useCallback(() => {
        window.clearTimeout(scrollTimer.current);
        scrollTimer.current = 0;
        scrollModeRef.current = initialScrollModeState();
    }, []);

    const reportScrollActivity = useCallback(
        (top: number) => {
            const previous = scrollTopRef.current;
            scrollTopRef.current = top;
            const now = performance.now();
            const { next, ipcChanged } = scrollModeUpdateFromSample(
                scrollModeRef.current,
                top,
                previous,
                now,
            );
            scrollModeRef.current = next;
            if (ipcChanged) {
                void invoke('set_scrolling', {
                    mode: next.mode,
                    ahead: next.ahead,
                });
            }
            window.clearTimeout(scrollTimer.current);
            scrollTimer.current = window.setTimeout(() => {
                if (scrollModeRef.current.mode === 'idle') {
                    return;
                }
                scrollModeRef.current = initialScrollModeState();
                void invoke('set_scrolling', { mode: 'idle', ahead: 0 });
            }, SCROLL_IDLE_MS);

            const node = viewportRef.current;
            if (node) {
                commitScrollJump(
                    computeScrollJumpState({
                        scrollHeight: node.scrollHeight,
                        clientHeight: node.clientHeight,
                        scrollTop: top,
                    }),
                );
            }
        },
        [commitScrollJump, scrollTopRef, viewportRef],
    );

    return {
        reportScrollActivity,
        resetScrollActivityForFolderChange,
        scrollModeRef,
        scrollTimerRef: scrollTimer,
    };
}
