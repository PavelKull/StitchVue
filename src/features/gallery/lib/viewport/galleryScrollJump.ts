export type ScrollJumpState = {
    canScroll: boolean;
    pointUp: boolean;
};

export function emptyScrollJumpState(): ScrollJumpState {
    return { canScroll: false, pointUp: false };
}

/** Spacer в StitchVueGrid — его высота задаёт scrollHeight viewport без resize самого viewport. */
export const GALLERY_VIEWPORT_SPACER_SELECTOR = '[data-gallery-spacer="true"]';
export const GALLERY_FOLDER_HEADER_SELECTOR = '[data-gallery-folder-header="true"]';

export function observeGalleryViewportScrollMetrics(
    viewport: HTMLElement,
    observer: ResizeObserver,
): void {
    observer.observe(viewport);
    const spacer = viewport.querySelector(GALLERY_VIEWPORT_SPACER_SELECTOR);
    if (spacer instanceof Element) {
        observer.observe(spacer);
    }
    const folderHeader = viewport.querySelector(GALLERY_FOLDER_HEADER_SELECTOR);
    if (folderHeader instanceof Element) {
        observer.observe(folderHeader);
    }
}

export function computeScrollJumpState(metrics: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
}): ScrollJumpState {
    const max = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
    const canScroll = max > 0;
    const pointUp = canScroll && metrics.scrollTop > metrics.clientHeight;
    return { canScroll, pointUp };
}

export function scrollJumpStatesEqual(
    a: ScrollJumpState,
    b: ScrollJumpState,
): boolean {
    return a.canScroll === b.canScroll && a.pointUp === b.pointUp;
}

/** Допуск «у нижнего края» при follow-max (B-001). */
export const SCROLL_END_BOTTOM_EPS = 2;

/** Порог отмены follow-max при прокрутке вверх. */
export const SCROLL_END_CANCEL_UP_EPS = 1;

/** Быстрый плавный прыжок по кнопке (мс), не нативный smooth на всю дистанцию. */
export const SCROLL_JUMP_ANIM_MIN_MS = 180;
export const SCROLL_JUMP_ANIM_MAX_MS = 380;

export function scrollJumpAnimationDurationMs(distancePx: number): number {
    const ms = distancePx * 0.22;
    return Math.min(
        SCROLL_JUMP_ANIM_MAX_MS,
        Math.max(SCROLL_JUMP_ANIM_MIN_MS, ms),
    );
}

/** Синхронизировать React-виртуализацию галереи после программного scrollTop. */
export function dispatchViewportScrollEvent(node: HTMLElement): void {
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
}

/** Пересчитать canScroll после смены высоты layout/pad без resize viewport. */
export const GALLERY_VIEWPORT_SCROLL_METRICS =
    'stitchvue:gallery-scroll-metrics';

export function dispatchViewportScrollMetrics(node: HTMLElement): void {
    node.dispatchEvent(
        new Event(GALLERY_VIEWPORT_SCROLL_METRICS, { bubbles: false }),
    );
}

/** Показать кастомный скроллбар галереи (программный прыжок / follow-max). */
export const GALLERY_VIEWPORT_SCROLL_REVEAL = 'stitchvue:gallery-scrollbar-reveal';

export function dispatchViewportScrollReveal(node: HTMLElement): void {
    node.dispatchEvent(
        new Event(GALLERY_VIEWPORT_SCROLL_REVEAL, { bubbles: false }),
    );
    dispatchViewportScrollEvent(node);
}

export type AnimateElementScrollTopOptions = {
    durationMs?: number;
    /** Обновление виртуализации на каждом кадре (onScroll при rAF не всегда срабатывает). */
    onFrame?: (scrollTop: number) => void;
    onComplete?: () => void;
};

/** Плавная прокрутка viewport; возвращает отмену (для нового прыжка / смены папки). */
export function animateElementScrollTop(
    node: HTMLElement,
    targetTop: number,
    options?: AnimateElementScrollTopOptions,
): () => void {
    const startTop = node.scrollTop;
    const delta = targetTop - startTop;
    if (Math.abs(delta) < 1) {
        node.scrollTop = targetTop;
        options?.onFrame?.(targetTop);
        dispatchViewportScrollReveal(node);
        options?.onComplete?.();
        return () => undefined;
    }
    const duration =
        options?.durationMs ??
        scrollJumpAnimationDurationMs(Math.abs(delta));
    const started = performance.now();
    let frame = 0;
    let finished = false;
    const finish = () => {
        if (finished) {
            return;
        }
        finished = true;
        options?.onComplete?.();
    };
    const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        const eased = 1 - (1 - t) ** 3;
        node.scrollTop = startTop + delta * eased;
        options?.onFrame?.(node.scrollTop);
        dispatchViewportScrollReveal(node);
        if (t < 1) {
            frame = requestAnimationFrame(step);
        } else {
            finish();
        }
    };
    frame = requestAnimationFrame(step);
    return () => {
        cancelAnimationFrame(frame);
        finish();
    };
}

export function scrollMax(
    scrollHeight: number,
    clientHeight: number,
): number {
    return Math.max(0, scrollHeight - clientHeight);
}

export function isAtScrollBottom(
    scrollTop: number,
    max: number,
    eps = SCROLL_END_BOTTOM_EPS,
): boolean {
    return max <= eps || scrollTop >= max - eps;
}

/** Снять pendingScrollToEnd: пользователь прокрутил вверх, или листинг и геометрия готовы и мы внизу. */
export function shouldClearPendingScrollToEnd(input: {
    pending: boolean;
    scrollTop: number;
    previousScrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    listingComplete: boolean;
    geometryComplete: boolean;
    animating: boolean;
}): boolean {
    if (!input.pending) {
        return false;
    }
    if (
        input.scrollTop < input.previousScrollTop - SCROLL_END_CANCEL_UP_EPS
    ) {
        return true;
    }
    if (input.animating) {
        return false;
    }
    const max = scrollMax(input.scrollHeight, input.clientHeight);
    if (
        input.listingComplete &&
        input.geometryComplete &&
        isAtScrollBottom(input.scrollTop, max)
    ) {
        return true;
    }
    return false;
}

/** Пока активен follow-max, вернуть scrollTop к низу, если viewport «отстал» от края. */
export function shouldReconcilePendingScrollToEnd(input: {
    pending: boolean;
    animating: boolean;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}): boolean {
    if (!input.pending || input.animating) {
        return false;
    }
    const max = scrollMax(input.scrollHeight, input.clientHeight);
    return !isAtScrollBottom(input.scrollTop, max);
}

/** Приклеить follow-max к выросшему scrollHeight, пока нет анимации прыжка. */
export function shouldStickFollowScrollGrowth(input: {
    pending: boolean;
    animating: boolean;
    previousHeight: number;
    scrollHeight: number;
}): boolean {
    if (!input.pending || input.animating) {
        return false;
    }
    return input.scrollHeight > input.previousHeight;
}
