import { pointerOverTopNavDock } from './topNavDock.ts';
import { REVEAL_PX } from '../../../../widgets/gallery-grid/scrollbarGeometry.ts';
import { scaleChromePx, UI_REF_WIDTH_PX } from './adaptiveUiScale.ts';

/** Глубина от верха галереи, в которой курсор вызывает peek (меньше высоты самой панели). */
const TOP_NAV_PEEK_ACTIVATE_BASE_PX = 8 + 28;
/** Зона над webview (строка заголовка), где peek тоже срабатывает */
const WINDOW_FRAME_TOP_BASE_PX = 32;
/** Полоса захвата ползунка плюс синее свечение, чтобы подъём по ползунку не открывал панель. */
const TOP_NAV_LANE_GUARD_EXTRA_BASE_PX = 72;
/** Пробный сдвиг к ползунку. 0 возвращает прежнюю границу зоны появления верхней панели. */
const TOP_NAV_LANE_TRIAL_PX = 40;

function topNavPeekActivateDepthPx(): number {
  return scaleChromePx(TOP_NAV_PEEK_ACTIVATE_BASE_PX);
}

function windowFrameTopPx(): number {
  return scaleChromePx(WINDOW_FRAME_TOP_BASE_PX);
}

function topNavLaneGuardPx(): number {
  const base =
    REVEAL_PX + scaleChromePx(TOP_NAV_LANE_GUARD_EXTRA_BASE_PX);
  return base - TOP_NAV_LANE_TRIAL_PX;
}

/** Эталонные значения при scale 1 (тесты и документация). */
export const TOP_NAV_PEEK_ACTIVATE_DEPTH_PX = scaleChromePx(
  TOP_NAV_PEEK_ACTIVATE_BASE_PX,
  UI_REF_WIDTH_PX,
);
export const WINDOW_FRAME_TOP_PX = scaleChromePx(
  WINDOW_FRAME_TOP_BASE_PX,
  UI_REF_WIDTH_PX,
);
export const TOP_NAV_LANE_GUARD_PX =
  REVEAL_PX +
  scaleChromePx(TOP_NAV_LANE_GUARD_EXTRA_BASE_PX, UI_REF_WIDTH_PX) -
  TOP_NAV_LANE_TRIAL_PX;

export function topNavPeekShouldShow(
    clientX: number,
    clientY: number,
    shellRect: DOMRect,
    target: EventTarget | null,
): boolean {
    const overShellHorizontally =
        clientX >= shellRect.left && clientX <= shellRect.right;
    if (!overShellHorizontally) {
        return false;
    }
    if (
        target instanceof Element &&
        target.closest("[data-scrollbar-obstacle='top']")
    ) {
        return true;
    }
    if (pointerOverTopNavDock(clientX, clientY)) {
        return true;
    }
    const bandTop = shellRect.top - windowFrameTopPx();
    const bandBottom = shellRect.top + topNavPeekActivateDepthPx();
    if (clientY < bandTop || clientY > bandBottom) {
        return false;
    }
    if (document.documentElement.dataset.scrollbarDrag === 'true') {
        return false;
    }
    const scrollbar = document.querySelector<HTMLElement>(
        '[data-gallery-scrollbar]',
    );
    if (scrollbar?.dataset.shown === 'true') {
        return false;
    }
    if (
        target instanceof Element &&
        target.closest('[data-gallery-scrollbar]')
    ) {
        return false;
    }
    const viewport = document.querySelector<HTMLElement>(
        '[data-gallery-viewport]',
    );
    const right = viewport?.getBoundingClientRect().right ?? shellRect.right;
    if (clientX <= right - topNavLaneGuardPx()) {
        return true;
    }
    return false;
}

/** Ползунок / правая полоса скролла не должны открывать нижнюю панель. */
export function toolbarPeekBlockedByScrollbar(
    clientX: number,
    target: EventTarget | null,
): boolean {
    if (
        target instanceof Element &&
        target.closest("[data-scrollbar-obstacle='bottom']")
    ) {
        return false;
    }
    if (document.documentElement.dataset.scrollbarDrag === 'true') {
        return true;
    }
    if (
        target instanceof Element &&
        target.closest('[data-gallery-scrollbar]')
    ) {
        return true;
    }
    const viewport = document.querySelector<HTMLElement>(
        '[data-gallery-viewport]',
    );
    const right = viewport?.getBoundingClientRect().right;
    if (right != null && clientX > right - topNavLaneGuardPx()) {
        return true;
    }
    return false;
}
