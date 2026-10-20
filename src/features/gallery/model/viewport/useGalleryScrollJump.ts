import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { LayoutMode } from '../../../../entities/gallery/layoutMode.ts';
import {
    animateElementScrollTop,
    computeScrollJumpState,
    dispatchViewportScrollReveal,
    emptyScrollJumpState,
    scrollJumpStatesEqual,
    scrollMax,
    shouldClearPendingScrollToEnd,
    type ScrollJumpState,
} from '../../lib/viewport/galleryScrollJump.ts';

export type UseGalleryScrollJumpParams = {
    viewportRef: RefObject<HTMLElement | null>;
    /** Синхронизация scrollTop в StitchVueGrid при программной прокрутке. */
    syncViewportScrollTopRef?: RefObject<((scrollTop: number) => void) | null>;
    orderedImagesLength: number;
    directoryKey: string;
    layoutMode: LayoutMode;
    rowsPerScreen: number;
    bottomOverlayReserve: number;
    listingComplete: boolean;
};

function publishViewportScrollTop(
    node: HTMLElement,
    sync: RefObject<((scrollTop: number) => void) | null> | undefined,
): void {
    const top = node.scrollTop;
    sync?.current?.(top);
    dispatchViewportScrollReveal(node);
}

function stickScrollToEnd(
    node: HTMLElement,
    sync: RefObject<((scrollTop: number) => void) | null> | undefined,
): void {
    node.scrollTop = scrollMax(node.scrollHeight, node.clientHeight);
    publishViewportScrollTop(node, sync);
}

export function useGalleryScrollJump({
    viewportRef,
    syncViewportScrollTopRef,
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
    const scrollJumpAnimatingRef = useRef(false);
    const scrollJumpAnimCancelRef = useRef<(() => void) | null>(null);
    const lastFollowScrollHeightRef = useRef(0);
    const listingCompleteRef = useRef(listingComplete);
    listingCompleteRef.current = listingComplete;

    const endScrollJumpAnimation = useCallback(() => {
        scrollJumpAnimatingRef.current = false;
        scrollJumpAnimCancelRef.current = null;
    }, []);

    const cancelScrollJumpAnimation = useCallback(() => {
        scrollJumpAnimCancelRef.current?.();
        endScrollJumpAnimation();
    }, [endScrollJumpAnimation]);

    const commitScrollJump = useCallback((next: ScrollJumpState) => {
        setScrollJump((current) =>
            scrollJumpStatesEqual(current, next) ? current : next,
        );
    }, []);

    const clearPendingScrollToEnd = useCallback(() => {
        pendingScrollToEndRef.current = false;
        lastFollowScrollHeightRef.current = 0;
    }, []);

    const followScrollGrowthIfNeeded = useCallback(
        (node: HTMLElement) => {
            if (
                !pendingScrollToEndRef.current ||
                scrollJumpAnimatingRef.current
            ) {
                return;
            }
            const height = node.scrollHeight;
            if (height <= lastFollowScrollHeightRef.current) {
                return;
            }
            lastFollowScrollHeightRef.current = height;
            stickScrollToEnd(node, syncViewportScrollTopRef);
        },
        [syncViewportScrollTopRef],
    );

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
        followScrollGrowthIfNeeded(node);
        commitScrollJump(
            computeScrollJumpState({
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
                scrollTop: node.scrollTop,
            }),
        );
    }, [commitScrollJump, followScrollGrowthIfNeeded, viewportRef]);

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
            cancelScrollJumpAnimation();
            if (toTop) {
                pendingScrollToEndRef.current = false;
                lastFollowScrollHeightRef.current = 0;
            } else {
                pendingScrollToEndRef.current = true;
                lastFollowScrollHeightRef.current = node.scrollHeight;
            }
            const reduceMotion = window.matchMedia(
                '(prefers-reduced-motion: reduce)',
            ).matches;
            const targetTop = toTop ? 0 : max;
            const syncFrame = (top: number) => {
                syncViewportScrollTopRef?.current?.(top);
            };
            if (reduceMotion) {
                node.scrollTop = targetTop;
                publishViewportScrollTop(node, syncViewportScrollTopRef);
                endScrollJumpAnimation();
            } else {
                scrollJumpAnimatingRef.current = true;
                scrollJumpAnimCancelRef.current = animateElementScrollTop(
                    node,
                    targetTop,
                    {
                        onFrame: syncFrame,
                        onComplete: endScrollJumpAnimation,
                    },
                );
            }
            commitScrollJump(
                computeScrollJumpState({
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                    scrollTop: node.scrollTop,
                }),
            );
        },
        [
            cancelScrollJumpAnimation,
            commitScrollJump,
            endScrollJumpAnimation,
            syncViewportScrollTopRef,
            viewportRef,
        ],
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
                lastFollowScrollHeightRef.current = 0;
            }
        },
        [viewportRef],
    );

    useEffect(() => {
        cancelScrollJumpAnimation();
        pendingScrollToEndRef.current = false;
        lastFollowScrollHeightRef.current = 0;
    }, [directoryKey, cancelScrollJumpAnimation]);

    useEffect(() => {
        const node = viewportRef.current;
        if (!node || orderedImagesLength === 0) {
            cancelScrollJumpAnimation();
            pendingScrollToEndRef.current = false;
            lastFollowScrollHeightRef.current = 0;
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
        cancelScrollJumpAnimation,
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
