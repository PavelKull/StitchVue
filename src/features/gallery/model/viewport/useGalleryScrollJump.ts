import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { LayoutMode } from '../../../../entities/gallery/layoutMode.ts';
import {
    animateElementScrollTop,
    computeScrollJumpState,
    dispatchViewportScrollReveal,
    emptyScrollJumpState,
    GALLERY_VIEWPORT_SCROLL_METRICS,
    observeGalleryViewportScrollMetrics,
    SCROLL_END_CANCEL_UP_EPS,
    scrollJumpStatesEqual,
    scrollMax,
    shouldClearPendingScrollToEnd,
    shouldStickFollowScrollGrowth,
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
    geometryComplete: boolean;
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
    geometryComplete,
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
    const geometryCompleteRef = useRef(geometryComplete);
    geometryCompleteRef.current = geometryComplete;

    const endScrollJumpAnimation = useCallback(() => {
        scrollJumpAnimatingRef.current = false;
        scrollJumpAnimCancelRef.current = null;
    }, []);

    const cancelScrollJumpAnimation = useCallback(() => {
        scrollJumpAnimatingRef.current = false;
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
                !shouldStickFollowScrollGrowth({
                    pending: pendingScrollToEndRef.current,
                    animating: scrollJumpAnimatingRef.current,
                    previousHeight: lastFollowScrollHeightRef.current,
                    scrollHeight: node.scrollHeight,
                })
            ) {
                return;
            }
            lastFollowScrollHeightRef.current = node.scrollHeight;
            stickScrollToEnd(node, syncViewportScrollTopRef);
        },
        [syncViewportScrollTopRef],
    );

    const settlePendingScrollToEndIfNeeded = useCallback(
        (node: HTMLElement) => {
            if (!pendingScrollToEndRef.current) {
                return;
            }
            if (
                shouldClearPendingScrollToEnd({
                    pending: true,
                    scrollTop: node.scrollTop,
                    previousScrollTop: node.scrollTop,
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                    listingComplete: listingCompleteRef.current,
                    geometryComplete: geometryCompleteRef.current,
                    animating: scrollJumpAnimatingRef.current,
                })
            ) {
                pendingScrollToEndRef.current = false;
                lastFollowScrollHeightRef.current = 0;
            }
        },
        [],
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
        settlePendingScrollToEndIfNeeded(node);
        commitScrollJump(
            computeScrollJumpState({
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
                scrollTop: node.scrollTop,
            }),
        );
    }, [
        commitScrollJump,
        followScrollGrowthIfNeeded,
        settlePendingScrollToEndIfNeeded,
        viewportRef,
    ]);

    const jumpGalleryScroll = useCallback(
        (toTop: boolean) => {
            const node = viewportRef.current;
            if (!node) {
                return;
            }
            const max = scrollMax(node.scrollHeight, node.clientHeight);
            if (max <= 0) {
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
            const stickAfterJump = () => {
                const still = viewportRef.current;
                if (!still) {
                    return;
                }
                followScrollGrowthIfNeeded(still);
                settlePendingScrollToEndIfNeeded(still);
            };
            if (reduceMotion) {
                node.scrollTop = targetTop;
                publishViewportScrollTop(node, syncViewportScrollTopRef);
                endScrollJumpAnimation();
                stickAfterJump();
            } else {
                scrollJumpAnimatingRef.current = true;
                scrollJumpAnimCancelRef.current = animateElementScrollTop(
                    node,
                    targetTop,
                    {
                        onFrame: syncFrame,
                        onComplete: () => {
                            const cancelled = !scrollJumpAnimatingRef.current;
                            endScrollJumpAnimation();
                            if (cancelled) {
                                return;
                            }
                            stickAfterJump();
                        },
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
            followScrollGrowthIfNeeded,
            settlePendingScrollToEndIfNeeded,
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
                    geometryComplete: geometryCompleteRef.current,
                    animating: scrollJumpAnimatingRef.current,
                })
            ) {
                if (
                    scrollTop <
                    previousScrollTop - SCROLL_END_CANCEL_UP_EPS
                ) {
                    cancelScrollJumpAnimation();
                }
                pendingScrollToEndRef.current = false;
                lastFollowScrollHeightRef.current = 0;
            }
        },
        [cancelScrollJumpAnimation, viewportRef],
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
        let rafAfterPaint = 0;
        rafAfterPaint = requestAnimationFrame(() => {
            syncScrollJump();
        });
        const onLayoutMetrics = () => syncScrollJump();
        const observer = new ResizeObserver(() => syncScrollJump());
        observeGalleryViewportScrollMetrics(node, observer);
        node.addEventListener(GALLERY_VIEWPORT_SCROLL_METRICS, onLayoutMetrics);
        return () => {
            cancelAnimationFrame(rafAfterPaint);
            observer.disconnect();
            node.removeEventListener(
                GALLERY_VIEWPORT_SCROLL_METRICS,
                onLayoutMetrics,
            );
        };
    }, [
        orderedImagesLength,
        directoryKey,
        layoutMode,
        rowsPerScreen,
        bottomOverlayReserve,
        listingComplete,
        geometryComplete,
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
