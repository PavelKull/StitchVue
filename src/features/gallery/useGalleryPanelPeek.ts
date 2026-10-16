import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';
import { loadPanelMemory } from './panelMemory.ts';
import { loadPreferences } from '../settings/settingsPreferences.ts';
import {
    toolbarPeekDistanceFromBottom,
    toolbarPeekShouldActivate,
    toolbarPeekShouldHide,
} from './toolbarPeekGeometry.ts';
import {
    topNavPeekShouldShow,
    toolbarPeekBlockedByScrollbar,
} from './topNavPeekGeometry.ts';

export const TOOLBAR_PEEK_HIDE_DELAY_MS = 400;

function initialTopNavVisible(): boolean {
    const prefs = loadPreferences();
    const pinned = prefs.rememberPanelsPinned
        ? loadPanelMemory().topNavPinned
        : true;
    return pinned || !prefs.panelsPeekOnEdge;
}

function initialToolbarVisible(): boolean {
    const prefs = loadPreferences();
    const pinned = prefs.rememberPanelsPinned
        ? loadPanelMemory().toolbarPinned
        : true;
    return pinned || !prefs.panelsPeekOnEdge;
}

export type UseGalleryPanelPeekParams = {
    shellRef: RefObject<HTMLElement | null>;
    overlayBlocksToolbarPeek: boolean;
    topNavPinned: boolean;
    toolbarPinned: boolean;
    panelsPeekOnEdge: boolean;
    galleryHasImages: () => boolean;
};

export function useGalleryPanelPeek({
    shellRef,
    overlayBlocksToolbarPeek,
    topNavPinned,
    toolbarPinned,
    panelsPeekOnEdge,
    galleryHasImages,
}: UseGalleryPanelPeekParams) {
    const [topNavVisible, setTopNavVisible] = useState(initialTopNavVisible);
    const [toolbarVisible, setToolbarVisible] = useState(initialToolbarVisible);
    const toolbarHideTimer = useRef(0);
    const toolbarMenuHold = useRef(false);

    const holdToolbarForMenu = useCallback((hold: boolean) => {
        toolbarMenuHold.current = hold;
        if (!hold) {
            return;
        }
        window.clearTimeout(toolbarHideTimer.current);
        toolbarHideTimer.current = 0;
        setToolbarVisible(true);
    }, []);

    useEffect(() => {
        if (topNavPinned || !panelsPeekOnEdge) {
            setTopNavVisible(true);
        }
    }, [topNavPinned, panelsPeekOnEdge]);

    useEffect(() => {
        if (
            overlayBlocksToolbarPeek ||
            topNavPinned ||
            !panelsPeekOnEdge
        ) {
            return;
        }
        function onWindowMouseMove(event: MouseEvent) {
            const shell = shellRef.current;
            if (!shell) {
                return;
            }
            if (!galleryHasImages()) {
                return;
            }
            setTopNavVisible(
                topNavPeekShouldShow(
                    event.clientX,
                    event.clientY,
                    shell.getBoundingClientRect(),
                    event.target,
                ),
            );
        }
        window.addEventListener('mousemove', onWindowMouseMove);
        return () => window.removeEventListener('mousemove', onWindowMouseMove);
    }, [
        overlayBlocksToolbarPeek,
        topNavPinned,
        panelsPeekOnEdge,
        shellRef,
        galleryHasImages,
    ]);

    useEffect(() => {
        if (toolbarPinned || !panelsPeekOnEdge) {
            setToolbarVisible(true);
        }
    }, [toolbarPinned, panelsPeekOnEdge]);

    useEffect(() => {
        if (!overlayBlocksToolbarPeek) {
            return;
        }
        window.clearTimeout(toolbarHideTimer.current);
        toolbarHideTimer.current = 0;
    }, [overlayBlocksToolbarPeek]);

    useEffect(() => {
        if (
            overlayBlocksToolbarPeek ||
            toolbarPinned ||
            !panelsPeekOnEdge
        ) {
            return;
        }
        function onWindowMouseMove(event: MouseEvent) {
            const shell = shellRef.current;
            if (!shell) {
                return;
            }
            const shellRect = shell.getBoundingClientRect();
            if (
                event.clientX < shellRect.left ||
                event.clientX > shellRect.right
            ) {
                return;
            }
            if (toolbarMenuHold.current) {
                window.clearTimeout(toolbarHideTimer.current);
                toolbarHideTimer.current = 0;
                setToolbarVisible(true);
                return;
            }
            const fromBottom = toolbarPeekDistanceFromBottom(event.clientY);
            if (toolbarPeekShouldActivate(fromBottom)) {
                if (
                    toolbarPeekBlockedByScrollbar(event.clientX, event.target)
                ) {
                    return;
                }
                window.clearTimeout(toolbarHideTimer.current);
                toolbarHideTimer.current = 0;
                setToolbarVisible(true);
            } else if (
                toolbarPeekShouldHide(fromBottom) &&
                !toolbarHideTimer.current
            ) {
                toolbarHideTimer.current = window.setTimeout(() => {
                    setToolbarVisible(false);
                    toolbarHideTimer.current = 0;
                }, TOOLBAR_PEEK_HIDE_DELAY_MS);
            }
        }
        window.addEventListener('mousemove', onWindowMouseMove);
        return () => {
            window.removeEventListener('mousemove', onWindowMouseMove);
            window.clearTimeout(toolbarHideTimer.current);
            toolbarHideTimer.current = 0;
        };
    }, [
        overlayBlocksToolbarPeek,
        toolbarPinned,
        panelsPeekOnEdge,
        shellRef,
    ]);

    return {
        topNavVisible,
        setTopNavVisible,
        toolbarVisible,
        setToolbarVisible,
        toolbarHideTimer,
        toolbarMenuHold,
        holdToolbarForMenu,
    };
}
