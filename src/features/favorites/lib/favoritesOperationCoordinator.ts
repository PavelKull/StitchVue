import type { ImageFile } from '../../../entities/image/types.ts';
import { pathKey } from '../../selection/lib/selection.ts';
import { coalesceQueuedFavoriteIntents } from './favoriteQueuedAddCoalesce.ts';

export type FilesystemOperationKind = 'mass-unfavorite' | 'file-operation';

export type FilesystemOperationState = {
    albumScope: string;
    operationId: string;
    kind: FilesystemOperationKind;
    phase: 'running' | 'finalizing';
};

export type ConflictDecision =
    | { status: 'free' }
    | {
          status: 'busy';
          operationId: string;
          kind: FilesystemOperationKind;
      };

export type FavoriteIntentStatus =
    | 'queued'
    | 'executing'
    | 'completed'
    | 'failed'
    | 'cancelled';

export type FavoriteAddIntent = {
    intentId: string;
    photoKey: string;
    photoPath: string;
    albumDirectory: string;
    desired: boolean;
    status: FavoriteIntentStatus;
    revision: number;
    sequence: number;
    overlayOperationId: string;
};

export type FavoriteAddExecutorResult =
    | 'completed'
    | 'failed'
    | 'retry_conflict'
    | 'skipped';

export type FavoriteAddDrainResult =
    | {
          kind: 'ok';
          results: Record<string, FavoriteAddExecutorResult>;
      }
    | { kind: 'pre_start_conflict' };

export type FavoriteAddExecutor = (
    intents: readonly FavoriteAddIntent[],
) => Promise<FavoriteAddDrainResult>;

export function normalizeFilesystemScope(path: string): string {
    return pathKey(path).toLowerCase();
}

/** Mirrors Rust `related` in file_ops/locks.rs (Windows path keys). */
export function filesystemPathsConflict(leftPath: string, rightPath: string): boolean {
    const left = normalizeFilesystemScope(leftPath);
    const right = normalizeFilesystemScope(rightPath);
    if (!left || !right) {
        return false;
    }
    if (left === right) {
        return true;
    }
    const leftPrefix = `${left}\\`;
    const rightPrefix = `${right}\\`;
    return left.startsWith(rightPrefix) || right.startsWith(leftPrefix);
}

export function massUnfavoriteAlbumScope(options: {
    parentDirectory: string | null;
    sessionPath: string;
}): string {
    return normalizeFilesystemScope(
        options.parentDirectory ?? options.sessionPath,
    );
}

export function isTemporaryFilesystemConflictMessage(message: string): boolean {
    const lower = message.toLowerCase();
    return (
        lower.includes('конфликтующая файловая операция') ||
        lower.includes('conflicting file operation')
    );
}

export type FavoritesOperationCoordinator = {
    snapshotOperations: () => readonly FilesystemOperationState[];
    snapshotIntents: () => readonly FavoriteAddIntent[];
    conflictForDirectory: (directory: string) => ConflictDecision;
    beginMassUnfavorite: (options: {
        operationId: string;
        parentDirectory: string | null;
        sessionPath: string;
    }) => void;
    setMassUnfavoritePhase: (
        operationId: string,
        phase: 'running' | 'finalizing',
    ) => void;
    endMassUnfavorite: (operationId: string) => string | null;
    beginFileOperation: (options: {
        operationId: string;
        albumDirectory: string;
    }) => void;
    endFileOperation: (operationId: string) => void;
    upsertAddIntent: (options: {
        intentId: string;
        photoKey: string;
        photoPath: string;
        albumDirectory: string;
        overlayOperationId: string;
        desired: boolean;
    }) => FavoriteAddIntent;
    getIntent: (photoKey: string) => FavoriteAddIntent | undefined;
    markIntentExecuting: (photoKey: string) => void;
    markIntentTerminal: (
        photoKey: string,
        status: 'completed' | 'failed' | 'cancelled',
    ) => void;
    drainQueuedAdds: (
        albumScope: string,
        execute: FavoriteAddExecutor,
    ) => Promise<void>;
    hasActiveAddIntentsForDirectory: (directory: string) => boolean;
};

export function createFavoritesOperationCoordinator(): FavoritesOperationCoordinator {
    let operations: FilesystemOperationState[] = [];
    const intents = new Map<string, FavoriteAddIntent>();
    let intentRevision = 0;
    let enqueueSequence = 0;
    let drainToken = 0;
    const drainInFlight = new Set<string>();

    function conflictForDirectory(directory: string): ConflictDecision {
        const scope = normalizeFilesystemScope(directory);
        for (const op of operations) {
            if (filesystemPathsConflict(op.albumScope, scope)) {
                return {
                    status: 'busy',
                    operationId: op.operationId,
                    kind: op.kind,
                };
            }
        }
        return { status: 'free' };
    }

    function beginMassUnfavorite(options: {
        operationId: string;
        parentDirectory: string | null;
        sessionPath: string;
    }) {
        const albumScope = massUnfavoriteAlbumScope(options);
        operations = operations.filter(
            (op) => op.operationId !== options.operationId,
        );
        operations.push({
            albumScope,
            operationId: options.operationId,
            kind: 'mass-unfavorite',
            phase: 'running',
        });
    }

    function setMassUnfavoritePhase(
        operationId: string,
        phase: 'running' | 'finalizing',
    ) {
        operations = operations.map((op) =>
            op.operationId === operationId ? { ...op, phase } : op,
        );
    }

    function endMassUnfavorite(operationId: string): string | null {
        const op = operations.find((item) => item.operationId === operationId);
        operations = operations.filter(
            (item) => item.operationId !== operationId,
        );
        return op?.albumScope ?? null;
    }

    function beginFileOperation(options: {
        operationId: string;
        albumDirectory: string;
    }) {
        operations = operations.filter(
            (op) => op.operationId !== options.operationId,
        );
        operations.push({
            albumScope: normalizeFilesystemScope(options.albumDirectory),
            operationId: options.operationId,
            kind: 'file-operation',
            phase: 'running',
        });
    }

    function endFileOperation(operationId: string) {
        operations = operations.filter(
            (item) => item.operationId !== operationId,
        );
    }

    function upsertAddIntent(options: {
        intentId: string;
        photoKey: string;
        photoPath: string;
        albumDirectory: string;
        overlayOperationId: string;
        desired: boolean;
    }): FavoriteAddIntent {
        intentRevision += 1;
        enqueueSequence += 1;
        const existing = intents.get(options.photoKey);
        if (existing?.status === 'executing') {
            const next: FavoriteAddIntent = {
                ...existing,
                desired: options.desired,
                revision: intentRevision,
            };
            intents.set(options.photoKey, next);
            return next;
        }
        if (!options.desired) {
            if (existing?.status === 'queued') {
                const cancelled: FavoriteAddIntent = {
                    ...existing,
                    desired: false,
                    status: 'cancelled',
                    revision: intentRevision,
                };
                intents.delete(options.photoKey);
                return cancelled;
            }
            return (
                existing ?? {
                    intentId: options.intentId,
                    photoKey: options.photoKey,
                    photoPath: options.photoPath,
                    albumDirectory: options.albumDirectory,
                    desired: false,
                    status: 'cancelled',
                    revision: intentRevision,
                    sequence: enqueueSequence,
                    overlayOperationId: options.overlayOperationId,
                }
            );
        }
        const intent: FavoriteAddIntent = {
            intentId: options.intentId,
            photoKey: options.photoKey,
            photoPath: options.photoPath,
            albumDirectory: options.albumDirectory,
            desired: true,
            status: 'queued',
            revision: intentRevision,
            sequence: enqueueSequence,
            overlayOperationId: options.overlayOperationId,
        };
        intents.set(options.photoKey, intent);
        return intent;
    }

    function queuedForScope(albumScope: string): FavoriteAddIntent[] {
        return [...intents.values()]
            .filter(
                (intent) =>
                    intent.status === 'queued' &&
                    intent.desired &&
                    filesystemPathsConflict(intent.albumDirectory, albumScope),
            )
            .sort((left, right) => left.sequence - right.sequence);
    }

    async function drainQueuedAdds(
        albumScope: string,
        execute: FavoriteAddExecutor,
    ): Promise<void> {
        const token = ++drainToken;
        if (drainInFlight.has(albumScope)) {
            return;
        }
        drainInFlight.add(albumScope);
        try {
            while (token === drainToken) {
                const queue = queuedForScope(albumScope);
                if (queue.length === 0) {
                    break;
                }
                if (conflictForDirectory(albumScope).status === 'busy') {
                    break;
                }
                const ready = queue.filter((intent) => {
                    const live = intents.get(intent.photoKey);
                    return (
                        live &&
                        live.status === 'queued' &&
                        live.desired &&
                        live.revision === intent.revision
                    );
                });
                const chunk = coalesceQueuedFavoriteIntents(ready);
                if (chunk.length === 0) {
                    break;
                }
                for (const intent of chunk) {
                    markIntentExecuting(intent.photoKey);
                }
                await runFavoriteAddChunk(execute, chunk);
            }
        } finally {
            drainInFlight.delete(albumScope);
        }
    }

    async function runFavoriteAddChunk(
        execute: FavoriteAddExecutor,
        chunk: readonly FavoriteAddIntent[],
    ) {
        const liveChunk = chunk.filter((intent) => {
            const live = intents.get(intent.photoKey);
            return live?.status === 'executing' && live.desired;
        });
        if (liveChunk.length === 0) {
            return;
        }
        const first = await execute(liveChunk);
        if (first.kind === 'pre_start_conflict') {
            for (const intent of liveChunk) {
                await runFavoriteAddSingle(execute, intent);
            }
            return;
        }
        for (const intent of liveChunk) {
            let result =
                first.results[intent.photoKey] ??
                ('failed' as FavoriteAddExecutorResult);
            if (result === 'retry_conflict') {
                result = await runFavoriteAddSingle(execute, intent);
            } else {
                finalizeIntent(intent.photoKey, result);
            }
        }
    }

    async function runFavoriteAddSingle(
        execute: FavoriteAddExecutor,
        intent: FavoriteAddIntent,
    ): Promise<FavoriteAddExecutorResult> {
        const live = intents.get(intent.photoKey);
        if (!live || live.status !== 'executing' || !live.desired) {
            return 'skipped';
        }
        markIntentExecuting(intent.photoKey);
        let batch = await execute([intent]);
        if (batch.kind === 'pre_start_conflict') {
            batch = await execute([intent]);
        }
        if (batch.kind === 'pre_start_conflict') {
            finalizeIntent(intent.photoKey, 'failed');
            return 'failed';
        }
        const result = batch.results[intent.photoKey] ?? 'failed';
        if (result === 'retry_conflict') {
            const retry = await execute([intent]);
            const retryResult =
                retry.kind === 'ok'
                    ? (retry.results[intent.photoKey] ?? 'failed')
                    : 'failed';
            finalizeIntent(intent.photoKey, retryResult);
            return retryResult;
        }
        finalizeIntent(intent.photoKey, result);
        return result;
    }

    function finalizeIntent(
        photoKey: string,
        result: FavoriteAddExecutorResult,
    ) {
        if (result === 'retry_conflict') {
            markIntentTerminal(photoKey, 'failed');
            return;
        }
        if (result === 'skipped') {
            markIntentTerminal(photoKey, 'cancelled');
            return;
        }
        markIntentTerminal(
            photoKey,
            result === 'completed' ? 'completed' : 'failed',
        );
    }

    function markIntentExecuting(photoKey: string) {
        const intent = intents.get(photoKey);
        if (!intent) {
            return;
        }
        intents.set(photoKey, { ...intent, status: 'executing' });
    }

    function markIntentTerminal(
        photoKey: string,
        _status: 'completed' | 'failed' | 'cancelled',
    ) {
        intents.delete(photoKey);
    }

    function hasActiveAddIntentsForDirectory(directory: string): boolean {
        const scope = normalizeFilesystemScope(directory);
        for (const intent of intents.values()) {
            if (!intent.desired) {
                continue;
            }
            if (intent.status !== 'queued' && intent.status !== 'executing') {
                continue;
            }
            if (
                normalizeFilesystemScope(intent.albumDirectory) === scope
            ) {
                return true;
            }
        }
        return false;
    }

    return {
        snapshotOperations: () => operations,
        snapshotIntents: () => [...intents.values()],
        conflictForDirectory,
        beginMassUnfavorite,
        setMassUnfavoritePhase,
        endMassUnfavorite,
        beginFileOperation,
        endFileOperation,
        upsertAddIntent,
        getIntent: (photoKey: string) => intents.get(photoKey),
        markIntentExecuting,
        markIntentTerminal,
        drainQueuedAdds,
        hasActiveAddIntentsForDirectory,
    };
}

export function intentTargetsFile(
    intent: FavoriteAddIntent,
    file: ImageFile,
): boolean {
    return pathKey(intent.photoPath) === pathKey(file.path);
}
