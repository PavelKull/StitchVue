import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { bottomScrollPadNeeded } from './bottomScrollPad.ts';

export function useGalleryBottomOverlayReserve(
    dockRef: RefObject<HTMLElement | null>,
): number {
    const [bottomOverlayReserve, setBottomOverlayReserve] = useState(0);

    useLayoutEffect(() => {
        const dock = dockRef.current;
        if (!dock) {
            return;
        }
        const measure = () => {
            const edgeRaw = getComputedStyle(dock).bottom;
            const edgePx = Number.parseFloat(edgeRaw);
            const next = bottomScrollPadNeeded(
                dock.offsetHeight,
                Number.isFinite(edgePx) ? edgePx : 16,
            );
            setBottomOverlayReserve((current) =>
                current === next ? current : next,
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(dock);
        return () => observer.disconnect();
    }, [dockRef]);

    return bottomOverlayReserve;
}
