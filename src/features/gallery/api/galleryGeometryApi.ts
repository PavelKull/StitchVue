import { invoke } from '@tauri-apps/api/core';

export function setVisibleRange(args: {
    start: number;
    end: number;
    focusStart: number;
    focusEnd: number;
    tier: number;
}): Promise<void> {
    return invoke('set_visible_range', args);
}

export function setGeometryRange(start: number, end: number): Promise<void> {
    return invoke('set_geometry_range', { start, end });
}
