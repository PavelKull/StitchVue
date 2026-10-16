import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { LayoutMode } from '../../entities/gallery/layoutMode.ts';
import {
    computeScrollJumpState,
    emptyScrollJumpState,
    scrollJumpStatesEqual,
    type ScrollJumpState,
} from './galleryScrollJump.ts';

export type UseGalleryScrollJumpParams = {
    viewportRef: RefObject<HTMLElement | null>;
    orderedImagesLength: number;
    directoryKey: string;
    layoutMode: LayoutMode;
    rowsPerScreen: number;
    bottomOverlayReserve: number;
};

export function useGalleryScrollJump({
    viewportRef,
    orderedImagesLength,
    directoryKey,
    layoutMode,
    rowsPerScreen,
    bottomOverlayReserve,
}: UseGalleryScrollJumpParams) {
    const [scrollJump, setScrollJump] = useState<ScrollJumpState>(
        emptyScrollJumpState,
    );

    const commitScrollJump = useCallback((next: ScrollJumpState) => {
        setScrollJump((current) =>
            scrollJumpStatesEqual(current, next) ? current : next,
        );
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
            const max = Math.max(0, node.scrollHeight - node.clientHeight);
            if (max <= 2) {
                return;
            }
            const reduceMotion = window.matchMedia(
                '(prefers-reduced-motion: reduce)',
            ).matches;
            node.scrollTo({
                top: toTop ? 0 : max,
                behavior: reduceMotion ? 'auto' : 'smooth',
            });
        },
        [viewportRef],
    );

    useEffect(() => {
        const node = viewportRef.current;
        if (!node || orderedImagesLength === 0) {
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
    };
}
