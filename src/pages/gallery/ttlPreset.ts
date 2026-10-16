export function ttlPreset(secs: number | null | undefined): string {
    if (secs == null) {
        return 'never';
    }
    if (secs <= 3 * 24 * 60 * 60) {
        return '3';
    }
    if (secs <= 7 * 24 * 60 * 60) {
        return '7';
    }
    return '30';
}
