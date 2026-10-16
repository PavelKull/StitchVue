import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TOP_NAV_LANE_GUARD_PX,
    TOP_NAV_PEEK_ACTIVATE_DEPTH_PX,
    WINDOW_FRAME_TOP_PX,
    topNavPeekShouldShow,
    toolbarPeekBlockedByScrollbar,
} from './topNavPeekGeometry.ts';

type FakeElInit = {
    attrs?: Record<string, string>;
    dataset?: Record<string, string>;
    rect?: { left: number; top: number; right: number; bottom: number };
    parent?: FakeElement;
};

class FakeElement {
    attrs: Record<string, string>;
    dataset: Record<string, string>;
    rect: { left: number; top: number; right: number; bottom: number };
    parent: FakeElement | null;

    constructor(init: FakeElInit = {}) {
        this.attrs = init.attrs ?? {};
        this.dataset = init.dataset ?? {};
        this.rect = init.rect ?? { left: 0, top: 0, right: 0, bottom: 0 };
        this.parent = init.parent ?? null;
    }

    getBoundingClientRect() {
        const { left, top, right, bottom } = this.rect;
        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
        };
    }

    closest(selector: string): FakeElement | null {
        if (selector === "[data-scrollbar-obstacle='top']") {
            if (this.attrs['data-scrollbar-obstacle'] === 'top') {
                return this;
            }
        }
        if (selector === "[data-scrollbar-obstacle='bottom']") {
            if (this.attrs['data-scrollbar-obstacle'] === 'bottom') {
                return this;
            }
        }
        if (selector === '[data-gallery-scrollbar]') {
            if (this.attrs['data-gallery-scrollbar'] !== undefined) {
                return this;
            }
        }
        return this.parent?.closest(selector) ?? null;
    }
}

(globalThis as { Element: typeof FakeElement }).Element = FakeElement;

type DocStub = {
    documentElement: { dataset: Record<string, string> };
    querySelector: (sel: string) => FakeElement | null;
};

let savedDocument: (typeof globalThis)['document'];

function installDocument(stub: DocStub) {
    savedDocument = globalThis.document;
    (globalThis as { document: DocStub }).document = stub;
}

function restoreDocument() {
    if (savedDocument !== undefined) {
        (globalThis as { document: typeof document }).document = savedDocument;
    }
}

function shellRect(top = 100, left = 0, right = 800): DOMRect {
    const width = right - left;
    const height = 600;
    return {
        left,
        top,
        right,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

test('topNavPeekShouldShow rejects horizontal miss', () => {
    installDocument({
        documentElement: { dataset: {} },
        querySelector: () => null,
    });
    assert.equal(topNavPeekShouldShow(-1, 110, shellRect(), null), false);
    assert.equal(topNavPeekShouldShow(900, 110, shellRect(), null), false);
    restoreDocument();
});

test('topNavPeekShouldShow obstacle top always shows inside shell width', () => {
    installDocument({
        documentElement: { dataset: {} },
        querySelector: () => null,
    });
    const target = new FakeElement({
        attrs: { 'data-scrollbar-obstacle': 'top' },
    });
    assert.equal(
        topNavPeekShouldShow(400, 500, shellRect(), target),
        true,
    );
    restoreDocument();
});

test('topNavPeekShouldShow band and lane guard', () => {
    const viewportRight = 800;
    const viewport = new FakeElement({
        attrs: { 'data-gallery-viewport': '' },
        rect: { left: 0, top: 100, right: viewportRight, bottom: 700 },
    });
    installDocument({
        documentElement: { dataset: {} },
        querySelector: (sel) => {
            if (sel === '[data-gallery-viewport]') {
                return viewport;
            }
            return null;
        },
    });
    const top = 100;
    const yInBand = top + TOP_NAV_PEEK_ACTIVATE_DEPTH_PX - 1;
    const xSafe = viewportRight - TOP_NAV_LANE_GUARD_PX - 10;
    assert.equal(
        topNavPeekShouldShow(xSafe, yInBand, shellRect(top), null),
        true,
    );
    const xInScrollbarLane = viewportRight - TOP_NAV_LANE_GUARD_PX + 5;
    assert.equal(
        topNavPeekShouldShow(xInScrollbarLane, yInBand, shellRect(top), null),
        false,
    );
    const yAboveBand = top - WINDOW_FRAME_TOP_PX - 1;
    assert.equal(
        topNavPeekShouldShow(xSafe, yAboveBand, shellRect(top), null),
        false,
    );
    restoreDocument();
});

test('topNavPeekShouldShow scrollbar drag and shown scrollbar block band', () => {
    const scrollbar = new FakeElement({
        attrs: { 'data-gallery-scrollbar': '' },
        dataset: { shown: 'true' },
    });
    installDocument({
        documentElement: { dataset: { scrollbarDrag: 'true' } },
        querySelector: (sel) =>
            sel === '[data-gallery-scrollbar]' ? scrollbar : null,
    });
    const top = 100;
    const yInBand = top + 5;
    assert.equal(
        topNavPeekShouldShow(100, yInBand, shellRect(top), null),
        false,
    );
    installDocument({
        documentElement: { dataset: {} },
        querySelector: (sel) =>
            sel === '[data-gallery-scrollbar]' ? scrollbar : null,
    });
    assert.equal(
        topNavPeekShouldShow(100, yInBand, shellRect(top), null),
        false,
    );
    restoreDocument();
});

test('toolbarPeekBlockedByScrollbar obstacle bottom does not block', () => {
    installDocument({
        documentElement: { dataset: {} },
        querySelector: () => null,
    });
    const target = new FakeElement({
        attrs: { 'data-scrollbar-obstacle': 'bottom' },
    });
    assert.equal(
        toolbarPeekBlockedByScrollbar(900, target),
        false,
    );
    restoreDocument();
});

test('toolbarPeekBlockedByScrollbar drag and scrollbar lane', () => {
    const viewport = new FakeElement({
        attrs: { 'data-gallery-viewport': '' },
        rect: { left: 0, top: 0, right: 800, bottom: 600 },
    });
    installDocument({
        documentElement: { dataset: { scrollbarDrag: 'true' } },
        querySelector: (sel) =>
            sel === '[data-gallery-viewport]' ? viewport : null,
    });
    assert.equal(toolbarPeekBlockedByScrollbar(100, null), true);
    const scrollTarget = new FakeElement({
        attrs: { 'data-gallery-scrollbar': '' },
    });
    installDocument({
        documentElement: { dataset: {} },
        querySelector: (sel) =>
            sel === '[data-gallery-viewport]' ? viewport : null,
    });
    assert.equal(
        toolbarPeekBlockedByScrollbar(100, scrollTarget),
        true,
    );
    assert.equal(toolbarPeekBlockedByScrollbar(800, null), true);
    assert.equal(toolbarPeekBlockedByScrollbar(100, null), false);
    restoreDocument();
});
