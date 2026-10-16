import { pointerOverTopNavDock } from './topNavDock.ts';
import { REVEAL_PX } from '../../widgets/gallery-grid/scrollbarGeometry.ts';

/** Глубина от верха галереи, в которой курсор вызывает peek (меньше высоты самой панели). */
export const TOP_NAV_PEEK_ACTIVATE_DEPTH_PX = 8 + 28;
/** Зона над webview (строка заголовка), где peek тоже срабатывает */
export const WINDOW_FRAME_TOP_PX = 32;
/** Полоса захвата ползунка плюс синее свечение, чтобы подъём по ползунку не открывал панель. */
const TOP_NAV_LANE_GUARD_BASE_PX = REVEAL_PX + 72;
/** Пробный сдвиг к ползунку. 0 возвращает прежнюю границу зоны появления верхней панели. */
const TOP_NAV_LANE_TRIAL_PX = 40;
export const TOP_NAV_LANE_GUARD_PX =
    TOP_NAV_LANE_GUARD_BASE_PX - TOP_NAV_LANE_TRIAL_PX;

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
    const bandTop = shellRect.top - WINDOW_FRAME_TOP_PX;
    const bandBottom = shellRect.top + TOP_NAV_PEEK_ACTIVATE_DEPTH_PX;
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
    if (clientX <= right - TOP_NAV_LANE_GUARD_PX) {
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
    if (right != null && clientX > right - TOP_NAV_LANE_GUARD_PX) {
        return true;
    }
    return false;
}
