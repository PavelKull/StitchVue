export type MassUnfavoriteDiagStage =
    | 'start'
    | 'preview_error'
    | 'confirm_branch'
    | 'background_start'
    | 'load_enter'
    | 'load_retain_gate'
    | 'load_release_gate'
    | 'finish_skip_nav'
    | 'finish_apply_nav'
    | 'finish_reconcile'
    | 'clear_optimistic_hide'
    | 'rollback';

export type MassUnfavoriteDiagPayload = {
    stage: MassUnfavoriteDiagStage;
    operationId?: string;
    navigationSessionId?: number;
    optimisticFullFavoritesClear?: boolean;
    targetCount?: number;
    listingImageCount?: number;
    childFolderCount?: number;
    hasParentDirectory?: boolean;
    retainGate?: boolean;
    dataSource?: 'hot_cache' | 'ipc' | 'stub';
    activeLoadCount?: number;
    reason?: string;
};

export function logMassUnfavoriteDiag(payload: MassUnfavoriteDiagPayload): void {
    if (!import.meta.env.DEV) {
        return;
    }
    console.debug('[stitchvue:mass-unfavorite]', payload);
}
