export type ScrollJumpState = {
    canScroll: boolean;
    pointUp: boolean;
};

export function emptyScrollJumpState(): ScrollJumpState {
    return { canScroll: false, pointUp: false };
}

export function computeScrollJumpState(metrics: {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
}): ScrollJumpState {
    const max = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
    const canScroll = max > 2;
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

/** Снять pendingScrollToEnd: пользователь прокрутил вверх или листинг готов и мы внизу. */
export function shouldClearPendingScrollToEnd(input: {
    pending: boolean;
    scrollTop: number;
    previousScrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    listingComplete: boolean;
}): boolean {
    if (!input.pending) {
        return false;
    }
    const max = scrollMax(input.scrollHeight, input.clientHeight);
    if (
        input.scrollTop < input.previousScrollTop - SCROLL_END_CANCEL_UP_EPS
    ) {
        return true;
    }
    if (input.listingComplete && isAtScrollBottom(input.scrollTop, max)) {
        return true;
    }
    return false;
}
