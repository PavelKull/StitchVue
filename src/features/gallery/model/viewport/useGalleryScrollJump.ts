import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { LayoutMode } from '../../../../entities/gallery/layoutMode.ts';
import {
    computeScrollJumpState,
    emptyScrollJumpState,
    scrollJumpStatesEqual,
    scrollMax,
    shouldClearPendingScrollToEnd,
    type ScrollJumpState,
} from '../../lib/viewport/galleryScrollJump.ts';

export type UseGalleryScrollJumpParams = {
    viewportRef: RefObject<HTMLElement | null>;
    orderedImagesLength: number;
    directoryKey: string;
    layoutMode: LayoutMode;
    rowsPerScreen: number;
    bottomOverlayReserve: number;
    listingComplete: boolean;
};

function stickScrollToEnd(node: HTMLElement): void {
    node.scrollTop = scrollMax(node.scrollHeight, node.clientHeight);
}

export function useGalleryScrollJump({
    viewportRef,
    orderedImagesLength,
    directoryKey,
    layoutMode,
    rowsPerScreen,
    bottomOverlayReserve,
    listingComplete,
}: UseGalleryScrollJumpParams) {
    const [scrollJump, setScrollJump] = useState<ScrollJumpState>(
        emptyScrollJumpState,
    );
    const pendingScrollToEndRef = useRef(false);
    const listingCompleteRef = useRef(listingComplete);
    listingCompleteRef.current = listingComplete;

    const commitScrollJump = useCallback((next: ScrollJumpState) => {
        setScrollJump((current) =>
            scrollJumpStatesEqual(current, next) ? current : next,
        );
    }, []);

    const clearPendingScrollToEnd = useCallback(() => {
        pendingScrollToEndRef.current = false;
    }, []);

    const syncScrollJump = useCallback(() => {
        const node = viewportRef.current;
        if (!node) {
            setScrollJump((current) =>
                current.canScroll || current.pointUp
                    ? emptyScrollJumpState()
                    : current,
            );
            return;
        }
        if (pendingScrollToEndRef.current) {
            stickScrollToEnd(node);
        }
        commitScrollJump(
            computeScrollJumpState({
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
                scrollTop: node.scrollTop,
            }),
        );
    }, [commitScrollJump, viewportRef]);

    const jumpGalleryScroll = useCallback(
        (toTop: boolean) => {
            const node = viewportRef.current;
            if (!node) {
                return;
            }
            const max = scrollMax(node.scrollHeight, node.clientHeight);
            if (max <= 2) {
                return;
            }
            if (toTop) {
                pendingScrollToEndRef.current = false;
            } else {
                pendingScrollToEndRef.current = true;
            }
            const reduceMotion = window.matchMedia(
                '(prefers-reduced-motion: reduce)',
            ).matches;
            const useAuto =
                pendingScrollToEndRef.current || reduceMotion;
            node.scrollTo({
                top: toTop ? 0 : max,
                behavior: useAuto ? 'auto' : 'smooth',
            });
            if (pendingScrollToEndRef.current) {
                stickScrollToEnd(node);
            }
            commitScrollJump(
                computeScrollJumpState({
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                    scrollTop: node.scrollTop,
                }),
            );
        },
        [commitScrollJump, viewportRef],
    );

    const notifyGalleryScrollTop = useCallback(
        (scrollTop: number, previousScrollTop: number) => {
            const node = viewportRef.current;
            if (!node || !pendingScrollToEndRef.current) {
                return;
            }
            if (
                shouldClearPendingScrollToEnd({
                    pending: true,
                    scrollTop,
                    previousScrollTop,
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                    listingComplete: listingCompleteRef.current,
                })
            ) {
                pendingScrollToEndRef.current = false;
            }
        },
        [viewportRef],
    );

    useEffect(() => {
        pendingScrollToEndRef.current = false;
    }, [directoryKey]);

    useEffect(() => {
        const node = viewportRef.current;
        if (!node || orderedImagesLength === 0) {
            pendingScrollToEndRef.current = false;
            setScrollJump(emptyScrollJumpState());
            return;
        }
        syncScrollJump();
        const observer = new ResizeObserver(() => syncScrollJump());
        observer.observe(node);
        return () => observer.disconnect();
    }, [
        orderedImagesLength,
        directoryKey,
        layoutMode,
        rowsPerScreen,
        bottomOverlayReserve,
        syncScrollJump,
        viewportRef,
    ]);

    return {
        scrollJump,
        syncScrollJump,
        jumpGalleryScroll,
        commitScrollJump,
        notifyGalleryScrollTop,
        clearPendingScrollToEnd,
    };
}
