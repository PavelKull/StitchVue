export const FAVORITE_PERF_LOG_TAG = '[stitchvue:favorite-perf]';

export type FavoritePerfChannel = 'direct' | 'queued' | 'selection';

export type FavoritePerfOutcome =
    | 'completed'
    | 'failed'
    | 'partial'
    | 'skipped';

export type FavoritePerfRecord = {
    operation_id: string;
    file_count: number;
    bytes_total: number;
    channel: FavoritePerfChannel;
    queue_wait_ms: number;
    ipc_ms: number;
    ui_apply_ms: number;
    total_ms: number;
    outcome: FavoritePerfOutcome;
};

const MAX_RECENT = 32;
const recentRecords: FavoritePerfRecord[] = [];
const queuedAtByPhotoKey = new Map<string, number>();

export function favoritePerfEnabled(): boolean {
    const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
    return env?.DEV === true;
}

function roundMs(value: number): number {
    return Math.max(0, Math.round(value));
}

export function logFavoritePerf(record: FavoritePerfRecord): void {
    if (!favoritePerfEnabled()) {
        return;
    }
    recentRecords.push(record);
    if (recentRecords.length > MAX_RECENT) {
        recentRecords.shift();
    }
    console.debug(FAVORITE_PERF_LOG_TAG, record);
}

export function snapshotFavoritePerfRecords(): readonly FavoritePerfRecord[] {
    return recentRecords;
}

export function noteFavoriteAddQueued(photoKey: string): void {
    if (!favoritePerfEnabled()) {
        return;
    }
    queuedAtByPhotoKey.set(photoKey, performance.now());
}

export function consumeFavoriteAddQueueWait(photoKey: string): number {
    if (!favoritePerfEnabled()) {
        return 0;
    }
    const started = queuedAtByPhotoKey.get(photoKey);
    queuedAtByPhotoKey.delete(photoKey);
    if (started === undefined) {
        return 0;
    }
    return roundMs(performance.now() - started);
}

export function sumFileBytes(files: readonly { size: number }[]): number {
    let total = 0;
    for (const file of files) {
        total += file.size > 0 ? file.size : 0;
    }
    return total;
}

export type FavoritePerfSession = {
    markIpcStart: () => void;
    markIpcEnd: () => void;
    finish: (outcome: FavoritePerfOutcome) => void;
};

export function startFavoritePerfSession(options: {
    operationId: string;
    fileCount: number;
    bytesTotal: number;
    channel: FavoritePerfChannel;
    queueWaitMs?: number;
}): FavoritePerfSession {
    const startedAt = performance.now();
    let ipcStart = 0;
    let ipcMs = 0;
    const queueWaitMs = options.queueWaitMs ?? 0;

    return {
        markIpcStart() {
            if (!favoritePerfEnabled()) {
                return;
            }
            ipcStart = performance.now();
        },
        markIpcEnd() {
            if (!favoritePerfEnabled() || ipcStart === 0) {
                return;
            }
            ipcMs = roundMs(performance.now() - ipcStart);
        },
        finish(outcome: FavoritePerfOutcome) {
            if (!favoritePerfEnabled()) {
                return;
            }
            const totalMs = roundMs(performance.now() - startedAt);
            const uiApplyMs = Math.max(0, totalMs - queueWaitMs - ipcMs);
            logFavoritePerf({
                operation_id: options.operationId,
                file_count: options.fileCount,
                bytes_total: options.bytesTotal,
                channel: options.channel,
                queue_wait_ms: queueWaitMs,
                ipc_ms: ipcMs,
                ui_apply_ms: uiApplyMs,
                total_ms: totalMs,
                outcome,
            });
        },
    };
}

export function installFavoritePerfDiag(): void {
    if (!favoritePerfEnabled()) {
        return;
    }
    const global = globalThis as typeof globalThis & {
        __stitchvueFavoritePerf?: () => readonly FavoritePerfRecord[];
    };
    global.__stitchvueFavoritePerf = () => snapshotFavoritePerfRecords();
}
