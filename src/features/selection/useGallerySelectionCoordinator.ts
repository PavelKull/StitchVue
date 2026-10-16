import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';
import type { DirectoryView } from '../../entities/folder/types';
import type { ServiceRole } from '../../entities/folder/serviceFolder';
import type { ImageFile } from '../../entities/image/types';
import {
    addRange,
    emptySelection,
    isClearSelectionHotkey,
    isSelectAllHotkey,
    isTypingTarget,
    pathKey,
    togglePath,
    type SelectionState,
} from './lib/selection.ts';
import {
    enterSelectionMode,
    escapeSelection,
} from './lib/selectionMode.ts';
import type { UnfavoriteGate } from './lib/unfavoriteGate.ts';
import {
    installSelectionDiagGlobals,
    selectionDiag,
    selectionDiagEnabled,
    selectionDiagKey,
} from './lib/selectionDiag.ts';

export type GallerySelectionCommands = {
    clearSelection: () => void;
    selectAllImages: () => void;
    deleteSelection: () => void;
    closeSettings: () => void;
    closeConfirm: () => void;
    closeUnfavoritePrompt: () => void;
    closeViewer: () => void;
    selectViewerPhoto: () => void;
    exitFullscreen: () => void;
};

function safeSelectionDiagEnabled(): boolean {
    try {
        return selectionDiagEnabled();
    } catch {
        return false;
    }
}

function safeSelectionDiag(
    kind: string,
    detail: Record<string, unknown>,
): void {
    try {
        selectionDiag(kind, detail);
    } catch {
        /* node tests / missing import.meta.env */
    }
}

/** Shared guard for grid toggle/extend and command handlers in trash folder. */
export function blocksGallerySelectionInServiceFolder(
    serviceRole: ServiceRole | null | undefined,
): boolean {
    return serviceRole === 'trash';
}

export function createStubGallerySelectionCommands(): GallerySelectionCommands {
    const noop = () => undefined as void;
    return {
        clearSelection: noop,
        selectAllImages: noop,
        deleteSelection: noop,
        closeSettings: noop,
        closeConfirm: noop,
        closeUnfavoritePrompt: noop,
        closeViewer: noop,
        selectViewerPhoto: noop,
        exitFullscreen: noop,
    };
}

export type GallerySelectionKeyboardContext = {
    commands: GallerySelectionCommands;
    typing: boolean;
    confirmMove: boolean;
    unfavoritePrompt: boolean;
    settingsOpen: boolean;
    unfavoriteBusy: boolean;
    viewerIndex: number | null;
    selectionMode: boolean;
    selectedCount: number;
    fileOperationActive: boolean;
    propertiesPath: string | null;
    appFullscreen: boolean;
    directoryKey: string | null;
    setPropertiesPath: (path: string | null) => void;
    setSelectionMode: (mode: boolean) => void;
    setSelection: (next: SelectionState | ((prev: SelectionState) => SelectionState)) => void;
};

export type GallerySelectionKeyDownResult =
    | 'handled'
    | 'ignored'
    | 'escape-clear-selection';

/** Pure keyboard routing for gallery selection (window capture phase). */
export function processGallerySelectionKeyDown(
    event: Pick<
        KeyboardEvent,
        'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'preventDefault' | 'stopPropagation' | 'target'
    >,
    ctx: GallerySelectionKeyboardContext,
): GallerySelectionKeyDownResult {
    const blocks = {
        isTypingTarget: ctx.typing,
        confirmMove: ctx.confirmMove,
        unfavoritePrompt: ctx.unfavoritePrompt,
        settingsOpen: ctx.settingsOpen,
        unfavoriteBusy: ctx.unfavoriteBusy,
        viewerIndex: ctx.viewerIndex,
        selectionMode: ctx.selectionMode,
        selectedCount: ctx.selectedCount,
    };
    if (
        safeSelectionDiagEnabled() &&
        (event.ctrlKey ||
            event.key === 'Escape' ||
            event.key === 'Delete' ||
            event.key === ' ')
    ) {
        selectionDiagKey(event as KeyboardEvent, blocks);
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        if (ctx.propertiesPath) {
            ctx.setPropertiesPath(null);
        } else if (ctx.confirmMove) {
            ctx.commands.closeConfirm();
        } else if (ctx.unfavoritePrompt) {
            ctx.commands.closeUnfavoritePrompt();
        } else if (ctx.settingsOpen) {
            ctx.commands.closeSettings();
        } else if (ctx.viewerIndex !== null) {
            ctx.commands.closeViewer();
        } else if (ctx.appFullscreen) {
            ctx.commands.exitFullscreen();
        } else {
            const cleared = escapeSelection(ctx.directoryKey);
            ctx.setSelectionMode(cleared.selectionMode);
            ctx.setSelection(cleared.selection);
            return 'escape-clear-selection';
        }
        return 'handled';
    }
    if (ctx.typing) {
        safeSelectionDiag('keydown-early-return', {
            earlyReturn: 'isTypingTarget',
            ...blocks,
        });
        return 'ignored';
    }
    if (ctx.confirmMove) {
        safeSelectionDiag('keydown-early-return', {
            earlyReturn: 'confirmMove',
            ...blocks,
        });
        return 'ignored';
    }
    if (ctx.unfavoritePrompt) {
        safeSelectionDiag('keydown-early-return', {
            earlyReturn: 'unfavoritePrompt',
            ...blocks,
        });
        return 'ignored';
    }
    if (ctx.settingsOpen) {
        safeSelectionDiag('keydown-early-return', {
            earlyReturn: 'settingsOpen',
            ...blocks,
        });
        return 'ignored';
    }
    if (isClearSelectionHotkey(event as KeyboardEvent) || isSelectAllHotkey(event as KeyboardEvent)) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (isClearSelectionHotkey(event as KeyboardEvent)) {
        safeSelectionDiag('ctrl-shift-a', {
            action: 'clearSelection',
            code: event.code,
            key: event.key,
            countBefore: ctx.selectedCount,
            ...blocks,
        });
        ctx.commands.clearSelection();
        return 'handled';
    }
    if (isSelectAllHotkey(event as KeyboardEvent)) {
        safeSelectionDiag('ctrl-a', {
            action: 'selectAllImages',
            code: event.code,
            key: event.key,
            countBefore: ctx.selectedCount,
            ...blocks,
        });
        ctx.commands.selectAllImages();
        return 'handled';
    }
    if (event.key === 'Delete' && !ctx.fileOperationActive) {
        event.preventDefault();
        ctx.commands.deleteSelection();
        return 'handled';
    }
    if (event.key === ' ' && ctx.viewerIndex !== null) {
        const target = event.target;
        if (
            target instanceof HTMLElement &&
            target.closest('button, a, input, textarea, select')
        ) {
            safeSelectionDiag('keydown-early-return', {
                earlyReturn: 'space-on-control',
                ...blocks,
            });
            return 'ignored';
        }
        event.preventDefault();
        ctx.commands.selectViewerPhoto();
        return 'handled';
    }
    return 'ignored';
}

export type UseGallerySelectionCoordinatorParams = {
    viewRef: RefObject<DirectoryView>;
    orderedRef: RefObject<readonly ImageFile[]>;
    showTrashMultiSelectToast: () => void;
    setPropertiesPath: (path: string | null) => void;
    confirmMoveRef: RefObject<ImageFile[] | null>;
    unfavoritePromptRef: RefObject<unknown | null>;
    settingsOpenRef: RefObject<boolean>;
    viewerIndexRef: RefObject<number | null>;
    fileOperationRef: RefObject<unknown | null>;
    unfavoriteGateRef: RefObject<UnfavoriteGate>;
    propertiesPathRef: RefObject<string | null>;
    appFullscreenRef: RefObject<boolean>;
};

export function useGallerySelectionCoordinator({
    viewRef,
    orderedRef,
    showTrashMultiSelectToast,
    setPropertiesPath,
    confirmMoveRef,
    unfavoritePromptRef,
    settingsOpenRef,
    viewerIndexRef,
    fileOperationRef,
    unfavoriteGateRef,
    propertiesPathRef,
    appFullscreenRef,
}: UseGallerySelectionCoordinatorParams) {
    const [selectionMode, setSelectionMode] = useState(false);
    const [selection, setSelection] = useState<SelectionState>(() =>
        emptySelection(null),
    );
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const selectionModeRef = useRef(selectionMode);
    selectionModeRef.current = selectionMode;

    const commandsRef = useRef<GallerySelectionCommands>(
        createStubGallerySelectionCommands(),
    );

    const toggleAt = useCallback(
        (index: number) => {
            const current = viewRef.current;
            const file = orderedRef.current[index];
            const countBefore = selectionRef.current.paths.length;
            if (!current.path || !file) {
                selectionDiag('toggleAt', {
                    aborted: 'missing-path-or-file',
                    index,
                    countBefore,
                });
                return;
            }
            if (blocksGallerySelectionInServiceFolder(current.serviceRole)) {
                selectionDiag('toggleAt', {
                    aborted: 'trash',
                    index,
                    path: file.path,
                    countBefore,
                });
                showTrashMultiSelectToast();
                return;
            }
            const ordered = orderedRef.current.map((item) => pathKey(item.path));
            setSelectionMode(enterSelectionMode());
            setSelection((previous) => {
                const next = togglePath(
                    previous,
                    pathKey(current.path ?? ''),
                    ordered,
                    pathKey(file.path),
                );
                selectionDiag('toggleAt', {
                    index,
                    path: file.path,
                    countBefore: previous.paths.length,
                    countAfter: next.paths.length,
                    selectionMode: true,
                    anchor: next.anchor,
                });
                return next;
            });
        },
        [orderedRef, showTrashMultiSelectToast, viewRef],
    );

    const extendAt = useCallback(
        (index: number) => {
            const current = viewRef.current;
            const file = orderedRef.current[index];
            const countBefore = selectionRef.current.paths.length;
            if (!current.path || !file) {
                selectionDiag('extendAt', {
                    aborted: 'missing-path-or-file',
                    index,
                    countBefore,
                });
                return;
            }
            if (blocksGallerySelectionInServiceFolder(current.serviceRole)) {
                selectionDiag('extendAt', {
                    aborted: 'trash',
                    index,
                    path: file.path,
                    countBefore,
                });
                showTrashMultiSelectToast();
                return;
            }
            const ordered = orderedRef.current.map((item) => pathKey(item.path));
            setSelectionMode(enterSelectionMode());
            setSelection((previous) => {
                const next = addRange(
                    previous,
                    pathKey(current.path ?? ''),
                    ordered,
                    pathKey(file.path),
                );
                selectionDiag('extendAt', {
                    index,
                    path: file.path,
                    countBefore: previous.paths.length,
                    countAfter: next.paths.length,
                    selectionMode: true,
                    anchor: next.anchor,
                });
                return next;
            });
        },
        [orderedRef, showTrashMultiSelectToast, viewRef],
    );

    useEffect(() => {
        installSelectionDiagGlobals();
        function onWindowKeyDown(event: globalThis.KeyboardEvent) {
            const currentView = viewRef.current;
            processGallerySelectionKeyDown(event, {
                commands: commandsRef.current,
                typing: isTypingTarget(event.target),
                confirmMove: confirmMoveRef.current !== null,
                unfavoritePrompt: unfavoritePromptRef.current !== null,
                settingsOpen: settingsOpenRef.current,
                unfavoriteBusy: unfavoriteGateRef.current.busy,
                viewerIndex: viewerIndexRef.current,
                selectionMode: selectionModeRef.current,
                selectedCount: selectionRef.current.paths.length,
                fileOperationActive: fileOperationRef.current !== null,
                propertiesPath: propertiesPathRef.current,
                appFullscreen: appFullscreenRef.current,
                directoryKey: currentView.path ? pathKey(currentView.path) : null,
                setPropertiesPath,
                setSelectionMode,
                setSelection,
            });
        }
        window.addEventListener('keydown', onWindowKeyDown, true);
        return () =>
            window.removeEventListener('keydown', onWindowKeyDown, true);
    }, [
        appFullscreenRef,
        confirmMoveRef,
        fileOperationRef,
        propertiesPathRef,
        setPropertiesPath,
        settingsOpenRef,
        unfavoriteGateRef,
        unfavoritePromptRef,
        viewRef,
        viewerIndexRef,
    ]);

    return {
        selection,
        setSelection,
        selectionMode,
        setSelectionMode,
        selectionRef,
        selectionModeRef,
        commandsRef,
        toggleAt,
        extendAt,
    };
}
