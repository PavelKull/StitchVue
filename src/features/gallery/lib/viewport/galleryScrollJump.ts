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
