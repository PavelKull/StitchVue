import test from 'node:test';
import assert from 'node:assert/strict';
import {
    blocksGallerySelectionInServiceFolder,
    createStubGallerySelectionCommands,
    processGallerySelectionKeyDown,
    type GallerySelectionKeyboardContext,
} from './useGallerySelectionCoordinator.ts';
import { emptySelection } from './lib/selection.ts';
import { escapeSelection } from './lib/selectionMode.ts';

function baseContext(
    overrides: Partial<GallerySelectionKeyboardContext> = {},
): GallerySelectionKeyboardContext {
    const commands = createStubGallerySelectionCommands();
    let selectionMode = false;
    let selection = emptySelection('c:\\photos');
    return {
        commands,
        typing: false,
        confirmMove: false,
        unfavoritePrompt: false,
        settingsOpen: false,
        unfavoriteBusy: false,
        viewerIndex: null,
        selectionMode,
        selectedCount: 0,
        fileOperationActive: false,
        propertiesPath: null,
        appFullscreen: false,
        directoryKey: 'c:\\photos',
        setPropertiesPath: () => undefined,
        setSelectionMode: (mode) => {
            selectionMode = mode;
        },
        setSelection: (next) => {
            selection =
                typeof next === 'function' ? next(selection) : next;
        },
        ...overrides,
    };
}

function keyEvent(
    key: string,
    init: Partial<KeyboardEvent> = {},
): KeyboardEvent & { prevented: boolean; stopped: boolean } {
    let prevented = false;
    let stopped = false;
    return {
        key,
        code: init.code ?? key,
        ctrlKey: init.ctrlKey ?? false,
        metaKey: init.metaKey ?? false,
        shiftKey: init.shiftKey ?? false,
        target: init.target ?? null,
        preventDefault: () => {
            prevented = true;
        },
        stopPropagation: () => {
            stopped = true;
        },
        prevented,
        stopped,
    } as KeyboardEvent & { prevented: boolean; stopped: boolean };
}

test('blocksGallerySelectionInServiceFolder only for trash', () => {
    assert.equal(blocksGallerySelectionInServiceFolder('trash'), true);
    assert.equal(blocksGallerySelectionInServiceFolder('favorites'), false);
    assert.equal(blocksGallerySelectionInServiceFolder(null), false);
});

test('Escape clears selection when no modal is open', () => {
    const ctx = baseContext();
    let cleared = false;
    ctx.setSelection = () => {
        cleared = true;
    };
    ctx.setSelectionMode = () => undefined;
    const event = keyEvent('Escape');
    const result = processGallerySelectionKeyDown(event, ctx);
    assert.equal(result, 'escape-clear-selection');
    assert.equal(cleared, true);
    assert.equal(escapeSelection('c:\\photos').selection.paths.length, 0);
});

test('Escape closes settings before clearing selection', () => {
    let closed = false;
    const ctx = baseContext({
        settingsOpen: true,
        commands: {
            ...createStubGallerySelectionCommands(),
            closeSettings: () => {
                closed = true;
            },
        },
    });
    const event = keyEvent('Escape');
    processGallerySelectionKeyDown(event, ctx);
    assert.equal(closed, true);
});

test('Ctrl+A routes to selectAllImages when not blocked', () => {
    let selected = false;
    const ctx = baseContext({
        commands: {
            ...createStubGallerySelectionCommands(),
            selectAllImages: () => {
                selected = true;
            },
        },
    });
    const event = keyEvent('a', { ctrlKey: true, code: 'KeyA' });
    processGallerySelectionKeyDown(event, ctx);
    assert.equal(selected, true);
});

test('Delete is ignored while file operation is active', () => {
    let deleted = false;
    const ctx = baseContext({
        fileOperationActive: true,
        commands: {
            ...createStubGallerySelectionCommands(),
            deleteSelection: () => {
                deleted = true;
            },
        },
    });
    const event = keyEvent('Delete');
    processGallerySelectionKeyDown(event, ctx);
    assert.equal(deleted, false);
});
