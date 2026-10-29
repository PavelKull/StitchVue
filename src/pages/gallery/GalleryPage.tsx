import { invoke } from '@tauri-apps/api/core';
import { samePathList } from '../../features/gallery/lib/indexing/indexingPathEquality';
import { ttlPreset } from './ttlPreset';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { flushSync } from 'react-dom';
import { setWindowFullscreen } from '../../features/app-fullscreen/lib/appFullscreenWindow';
import { useAppFullscreen } from '../../features/app-fullscreen/model/useAppFullscreen';
import {
    serviceFolderIcon,
    type ServiceRole,
} from '../../entities/folder/serviceFolder';
import type {
    DirectoryView,
    FolderShortcut,
} from '../../entities/folder/types';
import type {
    ImageFile,
    ImageMeta,
    ThumbInfo,
} from '../../entities/image/types';
import { coalesceFolderRefresh } from '../../features/gallery/lib/directory/folderRefresh';
import {
    createDeferredVoid,
    listingHasCompleteGeometry,
    listingHasTrustedGeometry,
} from '../../features/gallery/lib/viewport/galleryGeometryGate';
import { useGalleryPipelineEvents } from '../../features/gallery/model/pipeline/galleryPipelineEvents';
import { useGalleryBoot } from '../../features/gallery/model/boot/useGalleryBoot';
import { useGalleryDrives } from '../../features/gallery/model/directory/useGalleryDrives';
import { useGalleryDriveHotplug } from '../../features/gallery/model/directory/useGalleryDriveHotplug';
import {
    browseDirectory,
    selectFolder,
} from '../../features/select-folder/lib/selectFolder';
import { driveIconName } from '../../features/gallery/lib/chrome/driveIcon';
import { listingStamp } from '../../features/gallery/lib/listing/galleryListing';
import {
    captureVisiblePhotoRects,
    shouldStartPhotoFlip,
    type PhotoFlipRequest,
} from '../../widgets/gallery-grid/photoDeleteFlip';
import {
    applySortPress,
    DEFAULT_GALLERY_SORT,
    sortOrderName,
    sortPhotos,
    viewerIndexAfterRemoval,
    reconcileOpenViewerPath,
    type GallerySort,
} from '../../features/gallery/lib/listing/galleryOrder';
import {
    createGalleryHover,
    setHoverFolderSession,
    viewerEdge,
} from '../../features/gallery/lib/viewer/galleryHover';
import {
    hoverWindow,
    type HoverController,
} from '../../features/gallery/lib/pipeline/hoverPrefetch';
import {
    forgetHotFolder,
    recallHotFolder,
    rememberHotFolder,
    retainUnchanged,
} from '../../features/gallery/lib/cache/folderHotCache';
import { useGalleryIndexingSync } from '../../features/gallery/model/indexing/useGalleryIndexingSync';
import { useGalleryThumbProgress } from '../../features/gallery/useGalleryThumbProgress';
import {
    aheadForInterval,
    isFastPace,
    smoothInterval,
} from '../../features/gallery/lib/viewer/viewerPace';
import {
    cancelViewerPreload,
    notifyNeighborThumbs,
    preloadViewerNeighbors,
} from '../../features/gallery/lib/viewer/viewerPreload';
import {
    clampSidebarWidth,
    loadPanelMemory,
    savePanelMemory,
} from '../../features/gallery/lib/chrome/panelMemory';
import {
    toolbarPeekDistanceFromBottom,
    toolbarPeekShouldKeepOnLeave,
} from '../../features/gallery/lib/chrome/toolbarPeekGeometry';
import { topNavPeekShouldShow } from '../../features/gallery/lib/chrome/topNavPeekGeometry';
import { useGalleryPanelPeek } from '../../features/gallery/model/chrome/useGalleryPanelPeek';
import { useGalleryBottomOverlayReserve } from '../../features/gallery/model/viewport/useGalleryBottomOverlayReserve';
import { useGalleryScrollActivity } from '../../features/gallery/model/viewport/useGalleryScrollActivity';
import { useGalleryScrollJump } from '../../features/gallery/model/viewport/useGalleryScrollJump';
import { FolderIcon } from '../../shared/icons/SvgIcon';
import { StitchVueIcon } from '../../shared/icons/StitchVueIcon';
import {
    emptySelection,
    pathKey,
    pruneSelection,
    removePathsFromSelection,
    selectAll,
} from '../../features/selection/lib/selection';
import {
    clearSelectionPaths,
    enterSelectionMode,
    resetSelectionOnFolderChange,
    resolveUnfavoriteParentDirectory,
    selectionAfterMassUnfavorite,
    shouldShowSelectionActions,
    toggleSelectionModeButton,
} from '../../features/selection/lib/selectionMode';
import { SelectionDiagOverlay } from '../../features/selection/ui/SelectionDiagOverlay';
import {
    selectionDiag,
    selectionDiagEnabled,
} from '../../features/selection/lib/selectionDiag';
import { useGallerySelectionCoordinator } from '../../features/selection/useGallerySelectionCoordinator';
import {
    commandAvailability,
    confirmMoveText,
    favoritesNeedsReviewNotice,
    favoritesPartialSuccessNotice,
    fileOperationIsActiveInDirectory,
    fileOperationIsCopyToFavoritesInDirectory,
    needsMoveConfirm,
    operationId,
    operationNotice,
    progressLabel,
    summarize,
    type FileOperationState,
    type FileAction,
    type FileOperationProgress,
    type FileOperationResult,
    type OperationNotice,
    type FavoriteBatchPathResult,
    type FavoriteCopyOrigin,
    type RemoveFavoriteConfirmKind,
    type RemoveFavoriteCopyResult,
    type RestoreTrashResult,
    type ServiceFolderLocation,
} from '../../features/selection/lib/fileOperation';
import {
    batchUnfavoriteConfirmLines,
    batchUnfavoritePromptCopy,
    bucketUnfavoriteUiTargets,
    massTrashUnfavoriteCounts as computeMassTrashBatchCounts,
    type BatchUnfavoriteConfirmLine,
    type MassTrashUnfavoriteCounts,
    cleanupOutcomeFromStatus,
    historyWithoutRemovedFolder,
    interpretRemovalOutcome,
    massUnfavoriteFinishLandingKey,
    massUnfavoriteStartLandingKey,
    shouldApplyMassUnfavoriteSelectionReset,
    mergeCleanupOutcomes,
    pickCleanupFromResults,
    prepareFavoriteRemovalTargets,
    summarizeUnfavoriteBatch,
    summarizeUnfavoriteBatchDetailed,
    type UnfavoriteBatchItemResult,
    type UnfavoriteCleanupOutcome,
} from '../../features/selection/lib/removeFavoritesBatch';
import {
    batchAddNoticeToneAfterDiskTruth,
    classifyAttemptedFavoriteAddsAgainstDisk,
    classifyMassUnfavoriteWorkAfterTransportFailure,
    mayAnnounceAllBatchFailed,
    refetchFavoriteOriginPathsAfterIpcFailure,
} from '../../features/favorites/lib/favoritesDiskTruthAfterIpc';
import { logUnfavoriteBatchClassifyDebug } from '../../features/selection/lib/unfavoriteClassifyDiag';
import {
    beginUnfavorite,
    beginUnfavoriteConfirmPass,
    canResolveUnfavoriteConfirm,
    canStartUnfavorite,
    endUnfavorite,
    idleUnfavoriteGate,
    markUnfavoriteConfirmPending,
    type UnfavoriteGate,
} from '../../features/selection/lib/unfavoriteGate';
import { mapRemovalToUiRoute } from '../../features/favorites/lib/mapRemovalToUiRoute';
import {
    applyFavoriteOverlayPendingBatch,
    clearFavoriteOverlayForOperation,
    clearFavoriteOverlayIfGeneration,
    clearFavoriteOverlayKey,
    favoriteDisplayOn,
    isTerminalFavoriteAddOutcomeStatus,
    filterListingImagesForFavoriteOverlay,
    isFavoriteOverlayPending,
    isFavoriteOverlayBlockingAdd,
    mapSnapshotCopyOrigins,
    nextFavoriteOverlayGeneration,
    rollbackIndeterminateFavoriteOverlay,
    type FavoriteOverlayMap,
} from '../../features/favorites/lib/favoriteOptimisticOverlay';
import {
    beginFavoritePathsFetch,
    bumpFavoritePathsConfirmedRevision,
    favoriteNeedsReviewNotice,
    needsFavoritePathsResyncAfterStaleReject,
    resolveFavoritePathsFetch,
    shouldAnnounceFullFavoriteSuccess,
    type FavoritePathsSyncCounters,
} from '../../features/favorites/lib/favoritePathsServerSync';
import {
    browseErrorLooksLikeMissingFolder,
    favoritesActivityAfterRename,
} from '../../features/favorites/lib/favoritesCollectionLifecycle';
import {
    copyOriginRowsFromCache,
    ensureFavoriteCopyOriginCacheScope,
    mergeFavoriteCopyOriginCache,
    nextFavoritesFolderHideGeneration,
    shouldOptimisticallyHideFavoritesServiceFolder,
    type FavoritesServiceFolderHideOverlay,
} from '../../features/favorites/lib/favoriteMassUnfavoriteOptimistic';
import {
    buildFavoriteOptimisticMemorySnapshot,
    installFavoriteOptimisticMemoryDiag,
} from '../../features/favorites/lib/favoriteOptimisticMemoryDiag';
import { logMassUnfavoriteDiag } from '../../features/favorites/lib/favoriteMassUnfavoriteDiag';
import {
    consumeFavoriteAddQueueWait,
    installFavoritePerfDiag,
    noteFavoriteAddQueued,
    startFavoritePerfSession,
    sumFileBytes,
    type FavoritePerfSession,
} from '../../features/favorites/lib/favoritePerfDiag';
import {
    filterFoldersForOptimisticServiceHide,
    shouldRetainMassUnfavoriteGateOnLoad,
    shouldSkipPostBatchServiceFolderNavigation,
    shouldUseInstantParentNavAfterFavoritesClear,
    type MassUnfavoriteOptimisticParentNav,
} from '../../features/favorites/lib/massUnfavoriteNavigation';
import {
    createFavoritesOperationCoordinator,
    isTemporaryFilesystemConflictMessage,
    type FavoriteAddDrainResult,
    type FavoriteAddExecutorResult,
    type FavoriteAddIntent,
} from '../../features/favorites/lib/favoritesOperationCoordinator';
import {
    filterMassUnfavoriteStarOverlayEntries,
    isFavoriteAddIntentExecuting,
    shouldPreserveFavoritePathDuringMassUnfavorite,
} from '../../features/favorites/lib/favoriteReaddGuards';
import { shouldAttemptEmptyFavoritesCleanup } from '../../features/favorites/lib/favoritesEmptyFolderAfterAdds';
import {
    buildAlbumFolderTiles,
    favoritesFolderTileIsPendingCreate,
    nextFavoritesFolderPendingCreate,
    predictFavoritesServiceFolderPath,
    resolveFavoritesFolderVisibility,
    type FavoritesFolderPendingCreate,
} from '../../features/favorites/lib/favoritesFolderVisibility';
import { createFavoritesReconcileScheduler } from '../../features/favorites/lib/favoritesReconcile';
import { cleanupEmptyServiceFolder } from '../../features/folder/lib/folderMenu';
import {
    ConfirmMoveDialog,
    OperationNoticeView,
    SelectionActions,
} from '../../widgets/selection-actions/SelectionActions';
import { FavoriteTrashUnfavoriteDialog } from '../../widgets/favorites-trash-unfavorite-dialog/ui/FavoriteTrashUnfavoriteDialog';
import { FavoriteMissingOriginDialog } from '../../widgets/favorites-missing-origin-dialog/ui/FavoriteMissingOriginDialog';
import selectionActionsStyles from '../../widgets/selection-actions/SelectionActions.module.scss';
import { FolderSidebar } from '../../widgets/folder-sidebar/FolderSidebar';
import { orderFoldersForDisplay } from '../../features/folder/lib/folderOrder';
import { insertServiceFolder } from '../../features/folder/lib/insertServiceFolder';
import {
    captureFolderTileRects,
    playFolderTileFlip,
} from '../../features/folder/lib/folderTileFlip';
import { useFolderContextMenu } from '../../widgets/folder-context/useFolderContextMenu';
import type { LayoutMode } from '../../entities/gallery/layoutMode';
import {
    clearGallerySessionMemory,
    loadGallerySessionMemory,
    resolveInitialLayoutMode,
    resolveInitialRowsPerScreen,
    saveGallerySessionMemory,
    validateRowsPerScreen,
    ZOOM_DEFAULT,
} from '../../features/settings/lib/gallerySessionMemory';
import {
    loadPreferences,
    resetPreferencesToDefaults,
    savePreferences,
    type AppPreferences,
} from '../../features/settings/lib/settingsPreferences';
import { FOLDER_HEADER_TOP_PX } from '../../widgets/gallery-grid/folderHeaderScroll';
import { firstGeometryRange } from '../../widgets/gallery-grid/layout';
import {
    FOLDER_HEADER_MORPH_MS,
    StitchVueGrid,
    ZOOM_STEPS,
    nextZoom,
    rowsFromZoomIndex,
    zoomIndex,
} from '../../widgets/gallery-grid/StitchVueGrid';
import { GalleryScrollJumpButton } from '../../widgets/gallery-grid/GalleryScrollJumpButton';
import { BottomControlBar } from '../../widgets/bottom-control-bar/BottomControlBar';
import { useAppUpdate } from '../../features/app-update';
import { SettingsDialog } from '../../widgets/settings-dialog/SettingsDialog';
import { ImageViewer } from '../../widgets/image-viewer/ImageViewer';
import { PhotoPropertiesDialog } from '../../widgets/photo-properties/PhotoPropertiesDialog';
import { TopNavigationBar } from '../../widgets/top-navigation-bar/TopNavigationBar';
import { useExternalFileDrop } from '../../features/gallery/lib/directory/externalDrop';
import { usePathCopyFeedback } from '../../shared/hooks/usePathCopyFeedback';
import {
    recycleLocalTrashFile,
    trashEntryOrigin,
} from '../../features/trash/trashApi';
import { useTranslation } from 'react-i18next';
import {
    createEmptyView,
    withLocalizedDirectory,
} from '../../features/gallery/lib/directory/galleryDirectoryView';
import {
    GALLERY_OPENING_NOTICE_DELAY_MS,
    galleryEmptyI18nKeys,
    resolveGalleryEmptyKind,
} from '../../features/gallery/lib/listing/galleryEmptyState';
import { clearThumbnailCache } from '../../features/gallery/api/galleryCacheApi';
import {
    setGeometryRange,
    setVisibleRange,
} from '../../features/gallery/api/galleryGeometryApi';
import { startIndexing } from '../../features/gallery/api/galleryIndexingApi';
import { beginDirectorySession } from '../../features/gallery/api/gallerySessionApi';
import { restorePromptText } from '../../features/gallery/lib/directory/restorePromptText';
import { useGalleryFolderHistory } from '../../features/gallery/model/directory/useGalleryFolderHistory';
import { DISK_SERVICE_FOLDER_LEAF } from '../../entities/folder/serviceFolder';
import { formatInvokeError, setAppLocale } from '../../shared/i18n';
import { FolderViewTile } from '../../widgets/folder-tile/FolderViewTile';
import { useAnimatedModal } from '../../shared/ui/useAnimatedModal';
import { GallerySupportReminder } from '../../widgets/support-reminder/GallerySupportReminder';
import styles from './GalleryPage.module.scss';

type CacheUsage = {
    usedBytes: number;
    limitBytes: number;
    ttlSecs: number | null;
};

export function GalleryPage() {
    const { t, i18n } = useTranslation();
    useEffect(() => {
        setView((current) => {
            if (current.path !== null) {
                return current;
            }
            const title = t('places.thisComputer');
            return current.title === title ? current : { ...current, title };
        });
    }, [i18n.language, t]);
    const [view, setView] = useState<DirectoryView>(() =>
        createEmptyView(t('places.thisComputer')),
    );
    const { pathCopied, copyPath } = usePathCopyFeedback(view.path);
    const [status, setStatus] = useState<'scanning' | 'ready' | 'error'>(
        'scanning',
    );
    const [error, setError] = useState<string | null>(null);
    const [preferences, setPreferences] = useState<AppPreferences>(() =>
        loadPreferences(),
    );
    const initialMemory = useMemo(() => loadGallerySessionMemory(), []);
    const [rowsPerScreen, setRowsPerScreen] = useState(() =>
        resolveInitialRowsPerScreen(loadPreferences(), initialMemory),
    );
    const [fit] = useState(0);
    const [layoutMode, setLayoutMode] = useState<LayoutMode>(() =>
        resolveInitialLayoutMode(loadPreferences(), initialMemory),
    );
    const {
        drivesState,
        refreshDrives,
        refreshDrivesRef,
        abandonInFlightDriveRequests,
        applyHomeDrivesSnapshot,
    } = useGalleryDrives();
    const [sidebarPinned, setSidebarPinned] = useState(() =>
        loadPreferences().rememberPanelsPinned
            ? loadPanelMemory().sidebarPinned
            : true,
    );
    const [sidebarPeek, setSidebarPeek] = useState(false);
    const [topNavPinned, setTopNavPinned] = useState(() =>
        loadPreferences().rememberPanelsPinned
            ? loadPanelMemory().topNavPinned
            : true,
    );
    const [toolbarPinned, setToolbarPinned] = useState(() =>
        loadPreferences().rememberPanelsPinned
            ? loadPanelMemory().toolbarPinned
            : true,
    );
    const [sidebarWidth, setSidebarWidth] = useState(
        () => loadPanelMemory().sidebarWidth,
    );
    const [gallerySort, setGallerySort] =
        useState<GallerySort>(DEFAULT_GALLERY_SORT);
    const [favoritePaths, setFavoritePaths] = useState<ReadonlySet<string>>(
        new Set(),
    );
    const [favoriteOverlay, setFavoriteOverlay] = useState<FavoriteOverlayMap>(
        () => new Map(),
    );
    const favoriteOverlayGenerationsRef = useRef(new Map<string, number>());
    const favoriteOverlayRef = useRef(favoriteOverlay);
    favoriteOverlayRef.current = favoriteOverlay;
    const favoritePathsSyncRef = useRef<FavoritePathsSyncCounters>({
        latestRequestId: 0,
        revision: 0,
    });
    const [busyPaths, setBusyPaths] = useState<ReadonlySet<string>>(new Set());
    const [restorePrompt, setRestorePrompt] = useState<{
        file: ImageFile;
        code: string;
    } | null>(null);
    const [trashOriginPath, setTrashOriginPath] = useState<string | null>(null);
    const trashMultiSelectToastAt = useRef(0);
    const showTrashMultiSelectToastRef = useRef<() => void>(() => undefined);
    const viewerNavAt = useRef(0);
    const viewerIntervals = useRef<number[]>([]);
    const viewerDirection = useRef<1 | -1>(1);
    const viewerPrevious = useRef<number | null>(null);
    const [scrollRestore, setScrollRestore] = useState<{
        token: number;
        top: number;
    }>({ token: 0, top: 0 });
    const scrollRestoreToken = useRef(0);
    const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
    const shellRef = useRef<HTMLElement>(null);
    const photoGridViewportRef = useRef<HTMLDivElement>(null);
    const galleryViewportScrollSyncRef = useRef<
        ((scrollTop: number) => void) | null
    >(null);
    const bottomBarDockRef = useRef<HTMLDivElement>(null);
    const [folderListingBusy, setFolderListingBusy] = useState(true);
    const folderListingBusyRef = useRef(true);
    folderListingBusyRef.current = folderListingBusy;
    const [showOpeningNotice, setShowOpeningNotice] = useState(false);
    const openingNoticeTimerRef = useRef(0);
    const photoFlipGen = useRef(0);
    const [photoFlip, setPhotoFlip] = useState<PhotoFlipRequest | null>(null);
    const galleryLayerRef = useRef<HTMLDivElement>(null);
    const [sidebarLayoutWidthFreeze, setSidebarLayoutWidthFreeze] = useState<
        number | null
    >(null);
    const [sidebarLayoutMorph, setSidebarLayoutMorph] = useState(false);
    const [folderHeaderMorph, setFolderHeaderMorph] = useState(false);
    const [folderExitingKey, setFolderExitingKey] = useState<string | null>(
        null,
    );
    const [folderEnteringKey, setFolderEnteringKey] = useState<string | null>(
        null,
    );
    const folderCollapseTimerRef = useRef(0);
    const folderEnterTimerRef = useRef(0);
    const folderGridRef = useRef<HTMLDivElement | null>(null);
    const folderFlipPendingRef = useRef<Map<string, DOMRect> | null>(null);
    const suppressFolderRefreshUntilRef = useRef(0);
    const animationsEnabledRef = useRef(preferences.animationsEnabled);
    animationsEnabledRef.current = preferences.animationsEnabled;
    const {
        enabled: appFullscreen,
        phase: fullscreenPhase,
        target: fullscreenTarget,
        toggle: toggleAppFullscreenBase,
        setEnabled: setAppFullscreen,
    } = useAppFullscreen({
        getAnimationsEnabled: () => animationsEnabledRef.current,
    });
    const [fsLayoutFreeze, setFsLayoutFreeze] = useState<{
        width: number;
        height: number;
    } | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsTriggerRef = useRef<HTMLButtonElement>(null);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [fileOperation, setFileOperation] =
        useState<FileOperationState | null>(null);
    const [fileProgress, setFileProgress] =
        useState<FileOperationProgress | null>(null);
    const [unfavoriteBusy, setUnfavoriteBusy] = useState(false);
    const { setUpdateOperationsBlocked } = useAppUpdate();
    const [fileNotice, setFileNotice] = useState<OperationNotice | null>(null);
    const [confirmMove, setConfirmMove] = useState<ImageFile[] | null>(null);
    const [favoriteTrashUnfavorite, setFavoriteTrashUnfavorite] =
        useState<ImageFile | null>(null);
    /** FR-11 missing/unverified origin — A–D dialog (+ in-flight token). */
    const [favoriteMissingOrigin, setFavoriteMissingOrigin] = useState<{
        file: ImageFile;
        flightToken: string;
    } | null>(null);
    const [massTrashUnfavoriteOpen, setMassTrashUnfavoriteOpen] =
        useState(false);
    const [massTrashBatchCounts, setMassTrashBatchCounts] =
        useState<MassTrashUnfavoriteCounts | null>(null);
    const [unfavoritePrompt, setUnfavoritePrompt] = useState<
        | { mode: 'single'; file: ImageFile; kind: RemoveFavoriteConfirmKind }
        | {
              mode: 'batch';
              files: ImageFile[];
              confirmLines: BatchUnfavoriteConfirmLine[];
              sessionPath: string;
              parentDirectory: string | null;
          }
        | null
    >(null);
    const [showFileProgress, setShowFileProgress] = useState(false);
    const [usage, setUsage] = useState<CacheUsage | null>(null);
    const [metaVersion, setMetaVersion] = useState(0);
    const [thumbVersion, setThumbVersion] = useState(0);
    const [failedVersion, setFailedVersion] = useState(0);
    const metaRef = useRef(new Map<string, ImageMeta>());
    const thumbsRef = useRef(new Map<string, ThumbInfo>());
    const failedRef = useRef(new Map<string, string>());
    const requestId = useRef(0);
    const {
        folderThumbsLoading,
        folderThumbLoaderRef,
        beginFolderThumbProgress,
        seedFolderThumbProgress,
        syncFolderThumbnailsPending,
        noteBaseThumbReadyRef,
        noteThumbFailedRef,
    } = useGalleryThumbProgress({
        requestId,
        folderListingBusy,
        folderListingBusyRef,
        thumbsRef,
        failedRef,
    });
    const pipelineListenersReady = useRef(createDeferredVoid());
    const scanFolderRef = useRef<string | null>(null);
    const listingRescanRef = useRef(true);
    const resetScrollActivityRef = useRef<() => void>(() => undefined);
    const hoverRef = useRef<HoverController | null>(null);
    if (hoverRef.current == null) {
        hoverRef.current = createGalleryHover();
    }
    const viewRef = useRef(view);
    viewRef.current = view;
    const orderedRef = useRef<readonly ImageFile[]>([]);
    const viewerIndexRef = useRef(viewerIndex);
    viewerIndexRef.current = viewerIndex;
    const viewerHoldRef = useRef<ImageFile | undefined>(undefined);
    const viewerIndexHoldRef = useRef(0);
    const viewerOpen = viewerIndex !== null;
    const { mounted: viewerMounted, phase: viewerMotionPhase } =
        useAnimatedModal(viewerOpen);
    const { mounted: settingsOverlayMounted } = useAnimatedModal(settingsOpen);
    const { mounted: propertiesOverlayMounted } = useAnimatedModal(
        propertiesPath !== null,
    );
    const { mounted: confirmMoveOverlayMounted } = useAnimatedModal(
        confirmMove !== null,
    );
    const { mounted: unfavoriteOverlayMounted } = useAnimatedModal(
        unfavoritePrompt !== null,
    );
    const { mounted: missingOriginOverlayMounted } = useAnimatedModal(
        favoriteMissingOrigin !== null,
    );
    const { mounted: restoreOverlayMounted } = useAnimatedModal(
        restorePrompt !== null,
    );
    const overlayBlocksToolbarPeek =
        viewerMounted ||
        settingsOverlayMounted ||
        propertiesOverlayMounted ||
        confirmMoveOverlayMounted ||
        unfavoriteOverlayMounted ||
        missingOriginOverlayMounted ||
        restoreOverlayMounted;

    const galleryHasImages = useCallback(
        () => viewRef.current.images.length > 0,
        [],
    );
    const {
        topNavVisible,
        setTopNavVisible,
        toolbarVisible,
        setToolbarVisible,
        toolbarHideTimer,
        toolbarMenuHold,
        holdToolbarForMenu,
    } = useGalleryPanelPeek({
        shellRef,
        overlayBlocksToolbarPeek,
        topNavPinned,
        toolbarPinned,
        panelsPeekOnEdge: preferences.panelsPeekOnEdge,
        galleryHasImages,
    });

    const unfavoriteBatchRef = useRef<{
        sessionId: string;
        sessionPath: string;
        parentDirectory: string | null;
        readyFiles: ImageFile[];
        trashFiles: ImageFile[];
        /** FR-11 очередь (по одному диалогу). */
        fr11Files: ImageFile[];
        /** Standard confirm (не FR-11). */
        confirmFiles: ImageFile[];
        priorResults: UnfavoriteBatchItemResult[];
        trashResolution?: 'recycle_copy' | 'restore_origin';
        /** Накопленные FR-11 resolutions для единого batch pass. */
        fr11Resolved: {
            file: ImageFile;
            resolution:
                | 'return_to_source'
                | 'keep_copy'
                | 'recycle_copy'
                | `choose_folder:${string}`;
        }[];
    } | null>(null);
    const unfavoriteGateRef = useRef<UnfavoriteGate>(idleUnfavoriteGate());
    const lockedUnfavoritePathsRef = useRef(new Set<string>());
    const backgroundUnfavoriteRef = useRef(false);
    const massUnfavoriteOriginRef = useRef<{
        sessionId: string;
        sessionFavoritesPath: string;
        copyToOrigin: Map<string, string>;
        originGenerations: Map<string, number>;
        copyGenerations: Map<string, number>;
    } | null>(null);
    const massUnfavoriteOptimisticParentNavRef =
        useRef<MassUnfavoriteOptimisticParentNav | null>(null);
    const favoritesCoordinatorRef = useRef(
        createFavoritesOperationCoordinator(),
    );
    const favoriteCopyOriginCacheRef = useRef(new Map<string, string>());
    const favoriteCopyOriginCacheScopeRef = useRef<string | null>(null);
    const favoriteOriginLookupPendingRef = useRef(0);
    const optimisticFavoritesFolderHideRef =
        useRef<FavoritesServiceFolderHideOverlay | null>(null);
    const favoritesFolderHideGenerationsRef = useRef(new Map<string, number>());
    const [optimisticHiddenFolderKeys, setOptimisticHiddenFolderKeys] =
        useState<ReadonlySet<string>>(() => new Set());
    const [favoritesFolderPendingCreate, setFavoritesFolderPendingCreate] =
        useState<FavoritesFolderPendingCreate | null>(null);
    const [favoriteAddQueueRevision, setFavoriteAddQueueRevision] =
        useState(0);
    const [massUnfavoriteExitingFavorites, setMassUnfavoriteExitingFavorites] =
        useState(false);
    const skipBatchUnfavoriteRef = useRef<(files: ImageFile[]) => void>(
        () => undefined,
    );
    const fileOperationRef = useRef(fileOperation);
    if (fileOperation) {
        fileOperationRef.current = fileOperation;
    }

    function setUnfavoriteGate(next: UnfavoriteGate) {
        unfavoriteGateRef.current = next;
        setUnfavoriteBusy(next.busy);
    }

    function bumpFavoriteAddQueueRevision() {
        setFavoriteAddQueueRevision((value) => value + 1);
    }

    function syncFavoritesFolderPendingCreate(
        parentDirectory: string | null,
        folders?: readonly FolderShortcut[],
    ) {
        if (!parentDirectory) {
            setFavoritesFolderPendingCreate(null);
            return;
        }
        const viewingParent =
            !!viewRef.current.path &&
            pathKey(viewRef.current.path) === pathKey(parentDirectory) &&
            viewRef.current.serviceRole == null;
        if (
            viewRef.current.serviceRole &&
            viewRef.current.path &&
            pathKey(viewRef.current.path) === pathKey(parentDirectory)
        ) {
            setFavoritesFolderPendingCreate(null);
            return;
        }
        setFavoritesFolderPendingCreate(
            nextFavoritesFolderPendingCreate({
                parentDirectory,
                serviceRole: null,
                folders: folders ?? (viewingParent ? viewRef.current.folders : []),
                hasActiveAddIntents:
                    favoritesCoordinatorRef.current.hasActiveAddIntentsForDirectory(
                        parentDirectory,
                    ),
                copyInFlightForParent: fileOperationIsCopyToFavoritesInDirectory(
                    fileOperationRef.current,
                    parentDirectory,
                ),
                hideOverlay: optimisticFavoritesFolderHideRef.current,
            }),
        );
    }

    function releaseUnfavoriteGate(reason = 'gate_release') {
        const sessionId = unfavoriteGateRef.current.sessionId;
        if (
            sessionId &&
            reason !== 'load' &&
            !backgroundUnfavoriteRef.current
        ) {
            void coordinatorFinishFilesystemSession(sessionId);
        }
        if (sessionId && reason !== 'load' && reason !== 'gate_release') {
            logMassUnfavoriteDiag({
                stage: 'rollback',
                operationId: sessionId,
                reason,
            });
            teardownMassUnfavoritePresentation(sessionId);
            massUnfavoriteOriginRef.current = null;
            const hide = optimisticFavoritesFolderHideRef.current;
            if (hide && hide.operationId === sessionId) {
                optimisticFavoritesFolderHideRef.current = null;
                setOptimisticHiddenFolderKeys(new Set());
            }
        }
        massUnfavoriteOptimisticParentNavRef.current = null;
        setMassUnfavoriteExitingFavorites(false);
        setMassTrashUnfavoriteOpen(false);
        setMassTrashBatchCounts(null);
        setUnfavoriteGate(endUnfavorite());
        unfavoriteBatchRef.current = null;
    }
    const preferencesRef = useRef(preferences);
    preferencesRef.current = preferences;
    const settingsOpenRef = useRef(settingsOpen);
    settingsOpenRef.current = settingsOpen;
    const confirmMoveRef = useRef(confirmMove);
    confirmMoveRef.current = confirmMove;
    const unfavoritePromptRef = useRef(unfavoritePrompt);
    unfavoritePromptRef.current = unfavoritePrompt;
    const propertiesPathRef = useRef<string | null>(null);
    propertiesPathRef.current = propertiesPath;
    const appFullscreenRef = useRef(appFullscreen);
    appFullscreenRef.current = appFullscreen;

    const {
        selection,
        setSelection,
        selectionMode,
        setSelectionMode,
        selectionRef,
        selectionModeRef,
        commandsRef,
        toggleAt,
        extendAt,
    } = useGallerySelectionCoordinator({
        viewRef,
        orderedRef,
        showTrashMultiSelectToast: () => showTrashMultiSelectToastRef.current(),
        setPropertiesPath,
        confirmMoveRef,
        unfavoritePromptRef,
        settingsOpenRef,
        viewerIndexRef,
        fileOperationRef,
        unfavoriteGateRef,
        propertiesPathRef,
        appFullscreenRef,
    });
    const indexedPathsRef = useRef<string[]>([]);
    const thumbSeen = useRef(false);
    const noteThumbTimingRef = useRef<() => void>(() => undefined);
    const scrollTopRef = useRef(0);
    const layoutModeRef = useRef(layoutMode);
    layoutModeRef.current = layoutMode;
    const rowsRef = useRef(rowsPerScreen);
    rowsRef.current = rowsPerScreen;
    const refreshRef = useRef<(path: string) => void>(() => undefined);
    const favoritesRefetchRef = useRef<(path: string) => void>(() => undefined);
    const favoritesReconcileRef = useRef(
        createFavoritesReconcileScheduler((directoryKey) => {
            favoritesRefetchRef.current(directoryKey);
        }),
    );
    const refreshFolderImplRef = useRef<(path: string) => Promise<void>>(
        async () => undefined,
    );
    const loadImplRef = useRef<
        (
            path: string | null,
            record?: boolean,
            focusImagePath?: string | null,
        ) => Promise<void>
    >(async () => undefined);
    const {
        history,
        historyRef,
        recordHistory,
        goHistory,
        applyHistory,
    } = useGalleryFolderHistory((path, record) =>
        loadImplRef.current(path, record),
    );
    const scheduleFolderRefreshRef = useRef(
        coalesceFolderRefresh((path) => refreshFolderImplRef.current(path)),
    );
    const beginFolderExitAnimation = useCallback(
        (
            removedKey: string,
            patchView?: () => void,
            onComplete?: () => void,
        ) => {
            window.clearTimeout(folderCollapseTimerRef.current);
            const animate =
                scrollTopRef.current <= FOLDER_HEADER_TOP_PX &&
                preferencesRef.current.animationsEnabled;
            setFolderHeaderMorph(animate);
            setFolderEnteringKey(null);
            window.clearTimeout(folderEnterTimerRef.current);
            folderEnterTimerRef.current = 0;
            patchView?.();
            // Defer data-exit so a newly mounted ghost tile can paint at full opacity first.
            if (animate) {
                window.requestAnimationFrame(() => {
                    setFolderExitingKey(removedKey);
                });
            } else {
                setFolderExitingKey(removedKey);
            }
            folderCollapseTimerRef.current = window.setTimeout(
                () => {
                    folderCollapseTimerRef.current = 0;
                    const grid = folderGridRef.current;
                    folderFlipPendingRef.current =
                        animate && grid && viewRef.current.folders.length > 1
                            ? captureFolderTileRects(grid)
                            : null;
                    setFolderExitingKey(null);
                    setFolderHeaderMorph(false);
                    setView((view) => ({
                        ...view,
                        folders: view.folders.filter(
                            (folder) => pathKey(folder.path) !== removedKey,
                        ),
                    }));
                    onComplete?.();
                },
                animate ? FOLDER_HEADER_MORPH_MS : 0,
            );
        },
        [],
    );

    const applyRemovedServiceFolder = useCallback(
        (removed?: ServiceFolderLocation | null) => {
            if (!removed) {
                return;
            }
            const current = viewRef.current;
            const removedKey = pathKey(removed.folderPath);
            const parentKey = pathKey(removed.parentDirectory);
            const parentTitle =
                removed.parentDirectory.split(/[\\/]/).filter(Boolean).pop() ??
                removed.parentDirectory;
            const nextHistory = historyWithoutRemovedFolder(
                historyRef.current,
                removed.folderPath,
                removed.parentDirectory,
            );
            applyHistory(nextHistory);
            forgetHotFolder(removed.folderPath);
            if (preferencesRef.current.rememberLastFolder) {
                const memory = loadGallerySessionMemory();
                if (
                    memory.lastFolderPath &&
                    pathKey(memory.lastFolderPath) === removedKey
                ) {
                    saveGallerySessionMemory({
                        lastFolderPath: removed.parentDirectory,
                    });
                }
            }
            const ghostRole: ServiceRole | null =
                current.serviceRole === 'trash' ||
                current.serviceRole === 'favorites'
                    ? current.serviceRole
                    : (() => {
                          const leaf =
                              removed.folderPath
                                  .split(/[\\/]/)
                                  .filter(Boolean)
                                  .pop() ?? '';
                          if (leaf === DISK_SERVICE_FOLDER_LEAF.trash) {
                              return 'trash';
                          }
                          if (leaf === DISK_SERVICE_FOLDER_LEAF.favorites) {
                              return 'favorites';
                          }
                          const match = current.folders.find(
                              (folder) => pathKey(folder.path) === removedKey,
                          );
                          return match?.serviceRole ?? 'favorites';
                      })();
            const ghostName =
                removed.folderPath.split(/[\\/]/).filter(Boolean).pop() ??
                (ghostRole === 'trash'
                    ? DISK_SERVICE_FOLDER_LEAF.trash
                    : DISK_SERVICE_FOLDER_LEAF.favorites);
            const ghostFolder: FolderShortcut = {
                name: ghostName,
                path: removed.folderPath,
                kind: 'folder',
                serviceRole: ghostRole,
            };

            if (current.path && pathKey(current.path) === removedKey) {
                const cleared = selectionAfterMassUnfavorite(parentKey);
                setSelectionMode(cleared.selectionMode);
                setSelection(cleared.selection);
                const hide = optimisticFavoritesFolderHideRef.current;
                const instantParent =
                    shouldUseInstantParentNavAfterFavoritesClear({
                        currentPath: current.path,
                        removedFolderPath: removed.folderPath,
                        hide,
                    });
                if (instantParent && hide) {
                    massUnfavoriteOptimisticParentNavRef.current = {
                        sessionId: hide.operationId,
                        parentDirectory: removed.parentDirectory,
                    };
                    window.clearTimeout(folderCollapseTimerRef.current);
                    folderCollapseTimerRef.current = 0;
                    setFolderExitingKey(null);
                    setFolderHeaderMorph(false);
                    const hot = recallHotFolder(removed.parentDirectory);
                    if (hot) {
                        setGallerySort(hot.sort);
                        if (!preferencesRef.current.rememberZoom) {
                            setRowsPerScreen(hot.rowsPerScreen);
                        }
                        metaRef.current = new Map(hot.meta);
                        thumbsRef.current = new Map(hot.thumbs);
                        failedRef.current = new Map();
                        thumbSeen.current = hot.thumbs.length > 0;
                        setMetaVersion((value) => value + 1);
                        setThumbVersion((value) => value + 1);
                        setFailedVersion((value) => value + 1);
                        setView({
                            title: hot.title,
                            path: hot.path,
                            parent: hot.parent,
                            folders: filterFoldersForOptimisticServiceHide(
                                hot.folders,
                                hide,
                                hot.path,
                            ),
                            images: hot.images,
                            serviceRole: null,
                        });
                        setStatus('ready');
                        logMassUnfavoriteDiag({
                            stage: 'load_enter',
                            operationId: hide.operationId,
                            dataSource: 'hot_cache',
                        });
                    } else {
                        setView((view) => ({
                            ...view,
                            path: removed.parentDirectory,
                            serviceRole: null,
                            images: [],
                            folders: [],
                            title: parentTitle,
                        }));
                        logMassUnfavoriteDiag({
                            stage: 'load_enter',
                            operationId: hide.operationId,
                            dataSource: 'stub',
                        });
                    }
                    void loadImplRef.current(
                        removed.parentDirectory,
                        false,
                    );
                    return;
                }
                beginFolderExitAnimation(
                    removedKey,
                    () => {
                        setView((view) => ({
                            ...view,
                            path: removed.parentDirectory,
                            serviceRole: null,
                            images: [],
                            folders: [ghostFolder],
                            title: parentTitle,
                        }));
                    },
                    () => {
                        void loadImplRef.current(
                            removed.parentDirectory,
                            false,
                        );
                    },
                );
                return;
            }

            if (current.path && pathKey(current.path) === parentKey) {
                if (selectionRef.current.paths.length === 0) {
                    const cleared = selectionAfterMassUnfavorite(parentKey);
                    setSelectionMode(cleared.selectionMode);
                    setSelection(cleared.selection);
                }
                beginFolderExitAnimation(removedKey);
                scheduleFolderRefreshRef.current(removed.parentDirectory);
                void fetchFavoriteOriginPaths(removed.parentDirectory);
                return;
            }

            scheduleFolderRefreshRef.current(removed.parentDirectory);
        },
        [beginFolderExitAnimation],
    );
    const refreshUsage = useCallback(() => {
        void invoke<CacheUsage>('cache_usage')
            .then(setUsage)
            .catch(() => undefined);
    }, []);

    const onExternalDrop = useCallback(
        (target: { folder: string; image?: string }) => {
            void loadImplRef.current(target.folder, true, target.image ?? null);
        },
        [],
    );
    useExternalFileDrop(onExternalDrop);

    const bootLoad = useCallback((path: string | null) => {
        void loadImplRef.current(path);
    }, []);
    useGalleryBoot({
        refreshUsage,
        refreshDrives,
        load: bootLoad,
        pipelineListenersReady,
        showGalleryToast: setFileNotice,
        translate: t,
        abandonInFlightDriveRequests,
    });

    useGalleryDriveHotplug({
        viewRef,
        requestId,
        refreshDrivesRef,
        setView,
        applyHomeDrivesSnapshot,
    });

    useEffect(() => {
        return () => {
            void setWindowFullscreen(false);
        };
    }, []);

    const toggleAppFullscreen = useCallback(() => {
        toggleAppFullscreenBase();
    }, [toggleAppFullscreenBase]);

    useLayoutEffect(() => {
        if (fullscreenPhase !== 'preparing' || fullscreenTarget !== true) {
            return;
        }
        setSidebarPeek(false);
        window.clearTimeout(toolbarHideTimer.current);
        toolbarHideTimer.current = 0;
        if (!toolbarPinned && preferences.panelsPeekOnEdge) {
            setToolbarVisible(false);
        }
        if (!topNavPinned && preferences.panelsPeekOnEdge) {
            setTopNavVisible(false);
        }
    }, [
        fullscreenPhase,
        fullscreenTarget,
        toolbarPinned,
        topNavPinned,
        preferences.panelsPeekOnEdge,
    ]);

    useLayoutEffect(() => {
        if (fullscreenPhase === 'preparing' || fullscreenPhase === 'switching') {
            const node = photoGridViewportRef.current;
            if (node && node.clientWidth > 0 && node.clientHeight > 0) {
                setFsLayoutFreeze((current) =>
                    current ?? {
                        width: node.clientWidth,
                        height: node.clientHeight,
                    },
                );
            }
            return;
        }
        if (fullscreenPhase === 'settling' || fullscreenPhase === 'idle') {
            setFsLayoutFreeze(null);
        }
    }, [fullscreenPhase]);

    useEffect(() => {
        if (viewerIndex !== null) {
            setSidebarPeek(false);
        }
    }, [viewerIndex]);

    useEffect(() => {
        if (preferences.rememberZoom) {
            saveGallerySessionMemory({
                lastRowsPerScreen: validateRowsPerScreen(rowsPerScreen),
            });
        }
    }, [rowsPerScreen, preferences.rememberZoom]);

    useEffect(() => {
        if (preferences.rememberLayoutMode) {
            saveGallerySessionMemory({ lastLayoutMode: layoutMode });
        }
    }, [layoutMode, preferences.rememberLayoutMode]);

    useEffect(() => {
        if (preferences.rememberPanelsPinned) {
            savePanelMemory({ sidebarPinned });
        }
    }, [sidebarPinned, preferences.rememberPanelsPinned]);

    const toggleSidebarPin = useCallback(() => {
        const measured = photoGridViewportRef.current?.clientWidth;
        if (measured && measured > 0) {
            setSidebarLayoutWidthFreeze(measured);
        }
        setSidebarPinned((value) => !value);
    }, []);

    useEffect(() => {
        if (sidebarLayoutWidthFreeze === null) {
            return;
        }
        const node = galleryLayerRef.current;
        const release = () => {
            setSidebarLayoutWidthFreeze(null);
            setSidebarLayoutMorph(true);
            window.setTimeout(() => setSidebarLayoutMorph(false), 400);
        };
        const timer = window.setTimeout(release, 320);
        if (!node) {
            return () => window.clearTimeout(timer);
        }
        const onTransitionEnd = (event: TransitionEvent) => {
            if (event.propertyName === 'left' && event.target === node) {
                window.clearTimeout(timer);
                release();
            }
        };
        node.addEventListener('transitionend', onTransitionEnd);
        return () => {
            node.removeEventListener('transitionend', onTransitionEnd);
            window.clearTimeout(timer);
        };
    }, [sidebarLayoutWidthFreeze, sidebarPinned]);

    useEffect(() => {
        if (preferences.rememberPanelsPinned) {
            savePanelMemory({ topNavPinned });
        }
    }, [topNavPinned, preferences.rememberPanelsPinned]);

    useEffect(() => {
        if (preferences.rememberPanelsPinned) {
            savePanelMemory({ toolbarPinned });
        }
    }, [toolbarPinned, preferences.rememberPanelsPinned]);

    useEffect(() => {
        savePanelMemory({ sidebarWidth });
    }, [sidebarWidth]);

    useEffect(() => {
        const apply = () =>
            setSidebarWidth((width) =>
                clampSidebarWidth(width, window.innerWidth),
            );
        window.addEventListener('resize', apply);
        return () => window.removeEventListener('resize', apply);
    }, []);

    useEffect(() => {
        const windowed = hoverWindow(rowsPerScreen);
        hoverRef.current?.setContext({
            order: sortOrderName(gallerySort),
            first: windowed.first,
            extra: windowed.extra,
            longEdge: viewerEdge(),
            openPath: view.path,
        });
    }, [gallerySort, rowsPerScreen, view.path]);

    useEffect(() => () => hoverRef.current?.dispose(), []);

    useEffect(() => {
        if (!fileOperation) {
            setShowFileProgress(false);
            return;
        }
        const timer = window.setTimeout(() => setShowFileProgress(true), 300);
        return () => window.clearTimeout(timer);
    }, [fileOperation]);

    useEffect(() => {
        setUpdateOperationsBlocked(fileOperation !== null || unfavoriteBusy);
    }, [fileOperation, unfavoriteBusy, setUpdateOperationsBlocked]);

    function stashOpenFolder() {
        const current = viewRef.current;
        if (!current.path || current.images.length === 0) {
            return;
        }
        rememberHotFolder({
            path: current.path,
            title: current.title,
            parent: current.parent,
            folders: current.folders,
            images: current.images,
            sort: gallerySortRef.current,
            layoutMode: layoutModeRef.current,
            rowsPerScreen: rowsRef.current,
            scrollTop: scrollTopRef.current,
            meta: [...metaRef.current.entries()],
            thumbs: [...thumbsRef.current.entries()],
        });
    }

    async function load(
        path: string | null,
        record = true,
        focusImagePath: string | null = null,
    ) {
        if (path === null) {
            // Force so a remount cannot leave the sidebar stuck on an abandoned "loading" request.
            refreshDrivesRef.current(true);
        }
        const id = requestId.current + 1;
        requestId.current = id;
        photoFlipGen.current += 1;
        setPhotoFlip(null);
        setError(null);
        {
            const reset = resetSelectionOnFolderChange(
                path ? pathKey(path) : null,
            );
            setSelection(reset.selection);
            setSelectionMode(reset.selectionMode);
        }
        setConfirmMove(null);
        setUnfavoritePrompt(null);
        setFavoriteMissingOrigin(null);
        const retainUnfavoriteGate = shouldRetainMassUnfavoriteGateOnLoad({
            targetPath: path,
            gateSessionId: unfavoriteGateRef.current.sessionId,
            hide: optimisticFavoritesFolderHideRef.current,
            backgroundUnfavorite: backgroundUnfavoriteRef.current,
            optimisticParentNav: massUnfavoriteOptimisticParentNavRef.current,
        });
        logMassUnfavoriteDiag({
            stage: retainUnfavoriteGate ? 'load_retain_gate' : 'load_release_gate',
            operationId: unfavoriteGateRef.current.sessionId ?? undefined,
            navigationSessionId: id,
            retainGate: retainUnfavoriteGate,
        });
        if (!retainUnfavoriteGate) {
            releaseUnfavoriteGate('load');
        }
        setRestorePrompt(null);
        setFolderHeaderMorph(false);
        setFolderExitingKey(null);
        setFolderEnteringKey(null);
        window.clearTimeout(folderCollapseTimerRef.current);
        folderCollapseTimerRef.current = 0;
        window.clearTimeout(folderEnterTimerRef.current);
        folderEnterTimerRef.current = 0;
        scanFolderRef.current = path;
        listingRescanRef.current = true;
        setFolderListingBusy(true);
        folderListingBusyRef.current = true;
        beginFolderThumbProgress(id);
        setViewerIndex(null);
        cancelViewerPreload({ clearCache: true, reason: 'folder' });
        setHoverFolderSession(id);
        hoverRef.current?.leaveFolder();
        hoverRef.current?.leavePhoto();
        await beginDirectorySession(id, path);
        stashOpenFolder();
        scrollTopRef.current = 0;
        resetScrollActivityRef.current();
        scrollRestoreToken.current += 1;
        setScrollRestore({ token: scrollRestoreToken.current, top: 0 });
        const hot = path ? recallHotFolder(path) : null;
        const loadHide = optimisticFavoritesFolderHideRef.current;
        if (hot) {
            setGallerySort(hot.sort);
            if (!preferencesRef.current.rememberZoom) {
                setRowsPerScreen(hot.rowsPerScreen);
            }
            metaRef.current = new Map(hot.meta);
            thumbsRef.current = new Map(hot.thumbs);
            failedRef.current = new Map();
            thumbSeen.current = hot.thumbs.length > 0;
            setMetaVersion((value) => value + 1);
            setThumbVersion((value) => value + 1);
            setFailedVersion((value) => value + 1);
            setView({
                title: hot.title,
                path: hot.path,
                parent: hot.parent,
                folders: filterFoldersForOptimisticServiceHide(
                    hot.folders,
                    loadHide,
                    hot.path,
                ),
                images: hot.images,
                serviceRole: null,
            });
            setStatus('ready');
            seedFolderThumbProgress(id, hot.images);
        } else {
            setStatus('scanning');
            if (path) {
                metaRef.current = new Map();
                thumbsRef.current = new Map();
                failedRef.current = new Map();
                thumbSeen.current = false;
                setView((current) => ({
                    ...current,
                    path,
                    title: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
                    images: [],
                    folders: [],
                    serviceRole: null,
                }));
                seedFolderThumbProgress(id, []);
            } else {
                seedFolderThumbProgress(id, []);
            }
        }
        try {
            const next = await browseDirectory(path, id);
            if (requestId.current !== id) {
                return;
            }
            if (hot) {
                retainUnchanged(
                    hot.images,
                    next.images,
                    metaRef.current,
                    thumbsRef.current,
                    failedRef.current,
                );
            } else {
                metaRef.current = new Map();
                thumbsRef.current = new Map();
                thumbSeen.current = false;
                failedRef.current = new Map();
            }
            setMetaVersion((value) => value + 1);
            setThumbVersion((value) => value + 1);
            setFailedVersion((value) => value + 1);
            const folderHide = optimisticFavoritesFolderHideRef.current;
            let browseView = next;
            if (
                folderHide &&
                next.path &&
                pathKey(next.path) === pathKey(folderHide.parentDirectory)
            ) {
                browseView = {
                    ...next,
                    folders: next.folders.filter(
                        (folder) =>
                            pathKey(folder.path) !==
                            pathKey(folderHide.folderPath),
                    ),
                };
            }
            setView(withLocalizedDirectory(browseView));
            setStatus('ready');
            seedFolderThumbProgress(id, next.images);
            if (browseView.path && !browseView.serviceRole) {
                syncFavoritesFolderPendingCreate(
                    browseView.path,
                    browseView.folders,
                );
            } else {
                syncFavoritesFolderPendingCreate(null);
            }
            if (
                folderHide &&
                next.path &&
                pathKey(next.path) === pathKey(folderHide.parentDirectory) &&
                next.folders.some(
                    (folder) =>
                        pathKey(folder.path) === pathKey(folderHide.folderPath),
                )
            ) {
                const gateSession = unfavoriteGateRef.current.sessionId;
                if (
                    gateSession &&
                    folderHide.operationId === gateSession
                ) {
                    // Скрытие плитки уже применено — без повторной exit-анимации.
                } else {
                    beginFolderExitAnimation(pathKey(folderHide.folderPath));
                }
            }
            if (record) {
                recordHistory(next.path);
            }
            if (next.path === null) {
                // Home browse already has drives; keep the sidebar in sync even if list_drives is slow or abandoned.
                const homeDrives = next.folders.filter(
                    (folder) => folder.kind === 'drive',
                );
                applyHomeDrivesSnapshot(homeDrives);
            } else {
                void invoke('remember_folder', {
                    path: next.path,
                    name: next.title,
                });
                if (preferencesRef.current.rememberLastFolder) {
                    saveGallerySessionMemory({ lastFolderPath: next.path });
                }
            }
            const sorted = sortPhotos(next.images, gallerySortRef.current);
            indexedPathsRef.current = sorted.map((file) => file.path);
            if (sorted.length > 0 && next.path) {
                void startIndexing(next.path, sorted, id);
                reportGeometryRange(sorted.length);
            }
            if (focusImagePath) {
                const index = sorted.findIndex(
                    (file) => pathKey(file.path) === pathKey(focusImagePath),
                );
                if (index >= 0) {
                    setViewerIndex(index);
                }
            }
            void syncDisplayRotations(sorted.map((file) => file.path));
        } catch (browseError) {
            if (requestId.current !== id) {
                return;
            }
            setStatus('error');
            setError(
                browseError instanceof Error
                    ? browseError.message
                    : String(browseError),
            );
        } finally {
            if (requestId.current === id) {
                listingRescanRef.current = false;
                folderListingBusyRef.current = false;
                setFolderListingBusy(false);
                syncFolderThumbnailsPending();
            }
        }
    }
    loadImplRef.current = load;

    const reportVisible = useCallback(
        (
            start: number,
            end: number,
            tier: number,
            focusStart: number,
            focusEnd: number,
        ) => {
            void setVisibleRange({
                start,
                end,
                focusStart,
                focusEnd,
                tier,
            });
        },
        [],
    );

    const reportGeometry = useCallback((start: number, end: number) => {
        void setGeometryRange(start, end);
    }, []);

    function reportGeometryRange(fileCount: number) {
        const node = photoGridViewportRef.current;
        const range = firstGeometryRange(
            node?.clientWidth ?? 0,
            node?.clientHeight ?? 0,
            rowsRef.current,
            fileCount,
        );
        if (range.end > 0) {
            void setGeometryRange(range.start, range.end);
        }
    }

    async function openFolder() {
        const selected = await selectFolder();
        if (selected) {
            await load(selected);
        }
    }

    async function clearCache(): Promise<void> {
        await clearThumbnailCache();
        thumbsRef.current = new Map();
        setThumbVersion((value) => value + 1);
        refreshUsage();
        if (view.path && view.images.length > 0) {
            const sorted = sortPhotos(view.images, gallerySortRef.current);
            indexedPathsRef.current = sorted.map((file) => file.path);
            thumbSeen.current = false;
            await startIndexing(view.path, sorted, requestId.current);
            reportGeometryRange(sorted.length);
        }
    }

    const directoryKey = view.path ? pathKey(view.path) : null;
    const addServiceFolderToView = useCallback(
        (folderPath: string, role: ServiceRole) => {
            suppressFolderRefreshUntilRef.current = Date.now() + 3200;
            const atTop = scrollTopRef.current <= FOLDER_HEADER_TOP_PX;
            const key = pathKey(folderPath);
            const animate = preferencesRef.current.animationsEnabled;
            const hadFolders = viewRef.current.folders.length > 0;
            // First service folder: header max-height morph alone (same as «Удаленное»).
            // Later inserts (e.g. Избранное beside Удаленное): opacity fade + FLIP siblings.
            const grid = folderGridRef.current;
            folderFlipPendingRef.current =
                animate && hadFolders && grid
                    ? captureFolderTileRects(grid)
                    : null;
            setFolderHeaderMorph(atTop && animate);
            window.clearTimeout(folderEnterTimerRef.current);
            if (animate && hadFolders) {
                setFolderEnteringKey(key);
                folderEnterTimerRef.current = window.setTimeout(() => {
                    folderEnterTimerRef.current = 0;
                    setFolderEnteringKey(null);
                }, FOLDER_HEADER_MORPH_MS);
            } else {
                setFolderEnteringKey(null);
            }
            const nextFolders = insertServiceFolder(
                viewRef.current.folders,
                folderPath,
                role,
            );
            setView((current) => ({
                ...current,
                folders: insertServiceFolder(current.folders, folderPath, role),
            }));
            if (role === 'favorites') {
                const parent = viewRef.current.path;
                if (parent) {
                    syncFavoritesFolderPendingCreate(parent, nextFolders);
                    bumpFavoriteAddQueueRevision();
                }
            }
        },
        [],
    );

    const listingImages = useMemo(() => {
        if (view.serviceRole !== 'favorites') {
            return view.images;
        }
        return filterListingImagesForFavoriteOverlay(
            view.images,
            favoriteOverlay,
        );
    }, [view.images, view.serviceRole, favoriteOverlay]);

    const orderedImages = useMemo(
        () => sortPhotos(listingImages, gallerySort),
        [listingImages, gallerySort],
    );
    const orderStamp = useMemo(
        () => listingStamp(orderedImages, gallerySort),
        [orderedImages, gallerySort],
    );
    const geometryPending = useMemo(
        () =>
            status === 'ready' &&
            orderedImages.length > 0 &&
            !listingHasTrustedGeometry(
                orderedImages,
                metaRef.current,
                failedRef.current,
            ),
        [status, orderedImages, metaVersion, failedVersion],
    );
    const geometryComplete = useMemo(
        () =>
            listingHasCompleteGeometry(
                orderedImages,
                metaRef.current,
                failedRef.current,
            ),
        [orderedImages, metaVersion, failedVersion],
    );
    const albumFolderTiles = useMemo(() => {
        const directory = view.path;
        if (!directory) {
            return orderFoldersForDisplay(view.folders);
        }
        if (view.serviceRole) {
            return orderFoldersForDisplay(view.folders).filter(
                (folder) =>
                    !optimisticHiddenFolderKeys.has(pathKey(folder.path)),
            );
        }
        const hasActiveAdds =
            favoritesCoordinatorRef.current.hasActiveAddIntentsForDirectory(
                directory,
            );
        const visibility = resolveFavoritesFolderVisibility({
            albumDirectory: directory,
            pendingCreate: favoritesFolderPendingCreate,
            hiddenFolderKeys: optimisticHiddenFolderKeys,
            folders: view.folders,
            hasActiveFavoriteAdds: hasActiveAdds,
        });
        return buildAlbumFolderTiles({
            folders: view.folders,
            visibility,
            pendingCreate: favoritesFolderPendingCreate,
            albumDirectory: directory,
        });
    }, [
        view.folders,
        view.path,
        view.serviceRole,
        optimisticHiddenFolderKeys,
        favoritesFolderPendingCreate,
        favoriteAddQueueRevision,
        fileOperation,
        favoriteOverlay,
    ]);
    const visibleFolderCount = albumFolderTiles.length;
    const galleryEmptyKind = useMemo(
        () =>
            resolveGalleryEmptyKind({
                status,
                folderListingBusy,
                geometryPending,
                serviceRole: view.serviceRole,
                imageCount: listingImages.length,
                folderCount: visibleFolderCount,
                unsupportedFileCount: view.unsupportedFileCount ?? 0,
                optimisticLeavingFavorites:
                    massUnfavoriteExitingFavorites ||
                    (optimisticHiddenFolderKeys.size > 0 &&
                        view.serviceRole === 'favorites'),
            }),
        [
            status,
            folderListingBusy,
            geometryPending,
            view.serviceRole,
            listingImages.length,
            visibleFolderCount,
            view.unsupportedFileCount,
            optimisticHiddenFolderKeys,
            massUnfavoriteExitingFavorites,
        ],
    );
    useEffect(() => {
        if (galleryEmptyKind !== 'opening') {
            setShowOpeningNotice(false);
            window.clearTimeout(openingNoticeTimerRef.current);
            openingNoticeTimerRef.current = 0;
            return;
        }
        setShowOpeningNotice(false);
        openingNoticeTimerRef.current = window.setTimeout(() => {
            openingNoticeTimerRef.current = 0;
            setShowOpeningNotice(true);
        }, GALLERY_OPENING_NOTICE_DELAY_MS);
        return () => {
            window.clearTimeout(openingNoticeTimerRef.current);
            openingNoticeTimerRef.current = 0;
        };
    }, [galleryEmptyKind, directoryKey]);
    const galleryEmptyCopy = galleryEmptyI18nKeys(
        galleryEmptyKind === 'opening' && !showOpeningNotice
            ? 'none'
            : galleryEmptyKind,
    );

    const bottomOverlayReserve =
        useGalleryBottomOverlayReserve(bottomBarDockRef);
    const {
        scrollJump,
        jumpGalleryScroll,
        commitScrollJump,
        notifyGalleryScrollTop,
        clearPendingScrollToEnd,
    } = useGalleryScrollJump({
        viewportRef: photoGridViewportRef,
        syncViewportScrollTopRef: galleryViewportScrollSyncRef,
        orderedImagesLength: orderedImages.length,
        directoryKey: directoryKey ?? '',
        layoutMode,
        rowsPerScreen,
        bottomOverlayReserve,
        listingComplete: status === 'ready',
        geometryComplete,
    });
    const { reportScrollActivity, resetScrollActivityForFolderChange } =
        useGalleryScrollActivity({
            scrollTopRef,
            viewportRef: photoGridViewportRef,
            commitScrollJump,
        });
    const reportGalleryScrollActivity = useCallback(
        (top: number) => {
            notifyGalleryScrollTop(top, scrollTopRef.current);
            reportScrollActivity(top);
        },
        [notifyGalleryScrollTop, reportScrollActivity, scrollTopRef],
    );
    resetScrollActivityRef.current = () => {
        clearPendingScrollToEnd();
        resetScrollActivityForFolderChange();
    };

    orderedRef.current = orderedImages;

    useGalleryPipelineEvents(
        {
            requestId,
            scanFolderRef,
            metaRef,
            thumbsRef,
            failedRef,
            viewRef,
            refreshRef,
            favoritesRefetchRef,
            fileOperationRef,
            thumbSeen,
            noteThumbTimingRef,
            listingRescanRef,
            noteBaseThumbReadyRef,
            noteThumbFailedRef,
        },
        {
            setMetaVersion,
            setThumbVersion,
            setFailedVersion,
            setView,
            setFileProgress,
        },
        () => {
            pipelineListenersReady.current.resolve();
        },
    );

    useGalleryIndexingSync({
        geometryPending,
        folderPath: view.path,
        orderedImages,
        metaVersion,
        failedVersion,
        requestId,
        indexedPathsRef,
        metaRef,
        failedRef,
        reportGeometryRange,
    });
    const gallerySortRef = useRef(gallerySort);
    gallerySortRef.current = gallerySort;
    const viewedPathRef = useRef<string | null>(null);
    useEffect(() => {
        const path = viewedPathRef.current;
        if (!path || viewerIndexRef.current === null) {
            return;
        }
        const keyedPath = pathKey(path);
        const reconciled = reconcileOpenViewerPath(
            orderedImages.map((file) => pathKey(file.path)),
            keyedPath,
            viewerIndexRef.current,
        );
        if (reconciled.index === null || reconciled.path === null) {
            setViewerIndex(null);
            viewedPathRef.current = null;
            return;
        }
        // Delete/restore уже сдвинули индекс: не закрывать viewer, принять соседний кадр.
        if (reconciled.path !== keyedPath) {
            const neighbor = orderedImages[reconciled.index];
            if (neighbor) {
                viewedPathRef.current = neighbor.path;
            }
        }
        if (reconciled.index !== viewerIndexRef.current) {
            setViewerIndex(reconciled.index);
        }
    }, [orderStamp, orderedImages]);
    const orderedKeys = useMemo(
        () => orderedImages.map((file) => pathKey(file.path)),
        [orderedImages],
    );
    const liveSelection = useMemo(
        () => pruneSelection(selection, directoryKey, orderedKeys),
        [selection, directoryKey, orderedKeys],
    );
    const selectedKeys = useMemo(
        () => new Set(liveSelection.paths),
        [liveSelection.paths],
    );
    useEffect(() => {
        if (!selectionDiagEnabled()) {
            return;
        }
        if (selection.paths.length === 0 && !selectionMode) {
            return;
        }
        selectionDiag('selection-state', {
            rawPaths: selection.paths.length,
            livePaths: liveSelection.paths.length,
            selectionMode,
            directoryKey,
            selectionDirectoryKey: selection.directoryKey,
            dirMatch: selection.directoryKey === directoryKey,
            orderedKeys: orderedKeys.length,
            pruned: selection.paths.length !== liveSelection.paths.length,
        });
    }, [
        selection,
        selectionMode,
        liveSelection.paths.length,
        directoryKey,
        orderedKeys.length,
    ]);
    const serviceRole = view.serviceRole ?? null;
    const inFavorites = serviceRole === 'favorites';
    const resolveFavoriteStar = useCallback(
        (key: string) =>
            favoriteDisplayOn(
                key,
                favoritePaths,
                favoriteOverlay,
                inFavorites,
            ),
        [favoritePaths, favoriteOverlay, inFavorites],
    );
    const inTrash = serviceRole === 'trash';

    const showTrashMultiSelectToast = useCallback(() => {
        const now = Date.now();
        if (now - trashMultiSelectToastAt.current < 2500) {
            return;
        }
        trashMultiSelectToastAt.current = now;
        setFileNotice({
            tone: 'ok',
            text: t('trash.multiSelectBody'),
            details: [],
        });
    }, [t]);
    showTrashMultiSelectToastRef.current = showTrashMultiSelectToast;

    useEffect(() => {
        if (!inTrash) {
            return;
        }
        setSelectionMode(false);
        setSelection(emptySelection(directoryKey));
    }, [inTrash, directoryKey]);

    useEffect(() => {
        if (!propertiesPath || !inTrash) {
            setTrashOriginPath(null);
            return;
        }
        let alive = true;
        void trashEntryOrigin(propertiesPath)
            .then((origin) => {
                if (alive) {
                    setTrashOriginPath(origin);
                }
            })
            .catch(() => {
                if (alive) {
                    setTrashOriginPath(null);
                }
            });
        return () => {
            alive = false;
        };
    }, [propertiesPath, inTrash]);
    const viewerFile =
        viewerIndex !== null ? orderedImages[viewerIndex] : undefined;
    if (viewerFile) {
        viewerHoldRef.current = viewerFile;
    }
    if (viewerIndex !== null) {
        viewerIndexHoldRef.current = viewerIndex;
    }
    const viewerFileDisplay = viewerFile ?? viewerHoldRef.current;
    const viewerIndexDisplay = viewerIndex ?? viewerIndexHoldRef.current;
    useEffect(() => {
        if (viewerFile) {
            viewedPathRef.current = viewerFile.path;
        }
    }, [viewerFile?.path]);
    useEffect(() => {
        if (!view.path || inFavorites) {
            setFavoritePaths(new Set());
            return;
        }
        let cancel = false;
        const directory = view.path;
        const ticket = beginFavoritePathsFetch(
            favoritePathsSyncRef.current,
            directory,
        );
        void invoke<string[]>('favorite_origin_paths', { directory })
            .then((paths) => {
                if (cancel) {
                    return;
                }
                consumeFavoritePathsFetchResult(ticket, paths);
            })
            .catch(() => {
                if (cancel) {
                    return;
                }
                const state = favoritePathsApplyGuardState();
                const resolved = resolveFavoritePathsFetch(
                    ticket,
                    state,
                    [],
                    favoriteOverlayRef.current,
                );
                if (resolved.applied) {
                    setFavoritePaths(new Set());
                } else if (
                    needsFavoritePathsResyncAfterStaleReject(ticket, state)
                ) {
                    void fetchFavoriteOriginPaths(directory);
                }
            });
        return () => {
            cancel = true;
        };
    }, [view.path, inFavorites, fileOperation]);
    useEffect(() => {
        if (status !== 'ready' || !view.path || inFavorites) {
            return;
        }
        // Debounced light star refetch after browse ready (CL-P01); skip window in scheduler.
        favoritesReconcileRef.current.schedule(view.path);
    }, [status, view.path, inFavorites]);
    useEffect(() => {
        if (view.serviceRole !== 'favorites' || !view.path) {
            ensureFavoriteCopyOriginCacheScope(
                favoriteCopyOriginCacheRef.current,
                null,
                favoriteCopyOriginCacheScopeRef,
            );
            return;
        }
        if (status !== 'ready') {
            return;
        }
        const paths = view.images.map((file) => file.path);
        if (paths.length === 0) {
            return;
        }
        const scopePath = view.path;
        let alive = true;
        favoriteOriginLookupPendingRef.current += 1;
        void invoke<FavoriteCopyOrigin[]>('favorite_origins_for_copies', {
            paths,
        })
            .then((rows) => {
                if (!alive) {
                    return;
                }
                const current = viewRef.current;
                if (
                    current.serviceRole !== 'favorites' ||
                    !current.path ||
                    pathKey(current.path) !== pathKey(scopePath)
                ) {
                    return;
                }
                ensureFavoriteCopyOriginCacheScope(
                    favoriteCopyOriginCacheRef.current,
                    scopePath,
                    favoriteCopyOriginCacheScopeRef,
                );
                mergeFavoriteCopyOriginCache(
                    favoriteCopyOriginCacheRef.current,
                    rows,
                );
            })
            .catch(() => undefined)
            .finally(() => {
                favoriteOriginLookupPendingRef.current = Math.max(
                    0,
                    favoriteOriginLookupPendingRef.current - 1,
                );
            });
        return () => {
            alive = false;
        };
    }, [view.path, view.serviceRole, status, orderStamp, view.images.length]);
    useEffect(() => {
        installFavoriteOptimisticMemoryDiag(() =>
            buildFavoriteOptimisticMemorySnapshot({
                originCache: favoriteCopyOriginCacheRef.current,
                originCacheScopeKey: favoriteCopyOriginCacheScopeRef.current,
                overlay: favoriteOverlayRef.current,
                hiddenFolderKeys: optimisticHiddenFolderKeys,
                unfavoriteGateBusy: unfavoriteGateRef.current.busy,
                massUnfavoriteSessionActive:
                    massUnfavoriteOriginRef.current !== null,
                originLookupPending: favoriteOriginLookupPendingRef.current,
            }),
        );
        installFavoritePerfDiag();
    }, [optimisticHiddenFolderKeys]);
    useEffect(() => {
        if (view.serviceRole !== 'favorites' && massUnfavoriteExitingFavorites) {
            setMassUnfavoriteExitingFavorites(false);
        }
    }, [view.serviceRole, massUnfavoriteExitingFavorites]);
    const folderContext = useFolderContextMenu({
        onRenamed: (event) => {
            const activity = favoritesActivityAfterRename(
                event.serviceRole,
                event.newName,
            );
            if (activity === 'deactivated') {
                noteFavoritePathsConfirmedLocalMutation();
                favoriteOverlayRef.current = new Map();
                setFavoriteOverlay(new Map());
                setFavoritePaths(new Set());
            }
            const directory = viewRef.current.path;
            if (
                directory &&
                pathKey(directory) === pathKey(event.oldPath)
            ) {
                void loadImplRef.current(event.newPath, true);
                return;
            }
            if (directory) {
                scheduleFolderRefreshRef.current(directory);
                if (viewRef.current.serviceRole !== 'favorites') {
                    void fetchFavoriteOriginPaths(directory);
                }
            }
        },
        onRemovedServiceFolder: applyRemovedServiceFolder,
        onError: (message) => {
            setFileNotice({ tone: 'failed', text: message, details: [] });
        },
    });
    useEffect(() => {
        if (viewerIndex === null) {
            cancelViewerPreload({ reason: 'viewer-close' });
            viewerPrevious.current = null;
            void invoke('set_viewer', {
                path: null,
                ahead: 5,
                fast: false,
                direction: 0,
            });
            return;
        }
        const previous = viewerPrevious.current;
        if (previous !== viewerIndex) {
            const now = performance.now();
            const delta =
                viewerNavAt.current === 0 ? 0 : now - viewerNavAt.current;
            if (viewerNavAt.current !== 0 && delta > 0 && delta < 5000) {
                viewerIntervals.current.push(delta);
                if (viewerIntervals.current.length > 6) {
                    viewerIntervals.current.shift();
                }
            }
            viewerNavAt.current = now;
            if (previous != null) {
                viewerDirection.current = viewerIndex > previous ? 1 : -1;
            }
            viewerPrevious.current = viewerIndex;
        }
        const pace = smoothInterval(viewerIntervals.current);
        const ahead = aheadForInterval(pace);
        const fast = isFastPace(pace);
        preloadViewerNeighbors(
            orderedImages,
            viewerIndex,
            ahead,
            viewerDirection.current,
            fast,
            thumbsRef.current,
            orderStamp,
        );
        void invoke('set_viewer', {
            path: orderedImages[viewerIndex]?.path ?? null,
            ahead,
            fast,
            direction: viewerDirection.current,
        });
    }, [viewerIndex, orderedImages, orderStamp]);

    useEffect(() => {
        if (viewerIndex === null) {
            return;
        }
        notifyNeighborThumbs(thumbsRef.current);
    }, [thumbVersion, viewerIndex]);
    const targetFiles =
        liveSelection.paths.length > 0
            ? view.images.filter((file) => selectedKeys.has(pathKey(file.path)))
            : viewerFile
              ? [viewerFile]
              : [];
    const fileOpInThisFolder = fileOperationIsActiveInDirectory(
        fileOperation,
        view.path,
    );
    const commandsAvailable = commandAvailability({
        hasDirectory: view.path !== null,
        role: serviceRole,
        running: fileOperation !== null || unfavoriteBusy,
        targetCount: targetFiles.length,
    });
    const fileProgressText =
        showFileProgress && fileOperation !== null
            ? progressLabel(fileProgress)
            : null;
    const showBulkSelectionBar =
        !inTrash &&
        viewerIndex === null &&
        shouldShowSelectionActions(
            liveSelection.paths.length,
            fileProgressText !== null,
        );
    const bottomToolbarForced = showBulkSelectionBar;

    refreshFolderImplRef.current = refreshFolder;
    refreshRef.current = (path) => {
        scheduleFolderRefreshRef.current(path);
    };
    favoritesRefetchRef.current = (directory) => {
        if (viewRef.current.serviceRole === 'favorites') {
            return;
        }
        void fetchFavoriteOriginPaths(directory);
    };
    commandsRef.current = {
        clearSelection: () =>
            setSelection(
                emptySelection(
                    viewRef.current.path ? pathKey(viewRef.current.path) : null,
                ),
            ),
        selectAllImages: () => {
            const current = viewRef.current;
            if (!current.path) {
                selectionDiag('selectAllImages', { aborted: 'no-path' });
                return;
            }
            if (current.serviceRole === 'trash') {
                selectionDiag('selectAllImages', { aborted: 'trash' });
                showTrashMultiSelectToast();
                return;
            }
            const ordered = orderedRef.current.map((file) =>
                pathKey(file.path),
            );
            const directory = pathKey(current.path);
            const countBefore = selectionRef.current.paths.length;
            const next = selectAll(
                directory,
                ordered,
                selectionRef.current.anchor,
            );
            flushSync(() => {
                setSelectionMode(enterSelectionMode());
                setSelection(next);
            });
            const matched = current.images.filter((file) =>
                next.paths.includes(pathKey(file.path)),
            ).length;
            selectionDiag('selectAllImages', {
                countBefore,
                orderedCount: ordered.length,
                countAfterSync: selectionRef.current.paths.length,
                modeAfterSync: selectionModeRef.current,
                matchedInViewImages: matched,
                directoryKey: directory,
                sampleSel: next.paths[0] ?? null,
                sampleImg: current.images[0]
                    ? pathKey(current.images[0].path)
                    : null,
                path: current.path,
            });
        },
        deleteSelection: () => {
            const role = viewRef.current.serviceRole ?? null;
            const files = currentTargets();
            if (role === 'trash') {
                showTrashMultiSelectToast();
                return;
            }
            if (role === 'favorites') {
                return;
            }
            void runFileAction('move_to_local_trash', files);
        },
        closeSettings: () => setSettingsOpen(false),
        closeConfirm: () => setConfirmMove(null),
        closeUnfavoritePrompt: () => {
            const prompt = unfavoritePromptRef.current;
            if (prompt?.mode === 'batch') {
                skipBatchUnfavoriteRef.current(prompt.files);
                return;
            }
            setUnfavoritePrompt(null);
        },
        closeViewer: () => setViewerIndex(null),
        selectViewerPhoto: () => {
            if (viewRef.current.serviceRole === 'trash') {
                showTrashMultiSelectToast();
                return;
            }
            const index = viewerIndexRef.current;
            if (index === null) {
                return;
            }
            setSelectionMode(true);
            toggleAt(index);
        },
        exitFullscreen: () => {
            setAppFullscreen(false);
        },
    };

    function currentTargets(): ImageFile[] {
        const current = viewRef.current;
        const key = current.path ? pathKey(current.path) : null;
        const orderedFiles = orderedRef.current;
        const ordered = orderedFiles.map((file) => pathKey(file.path));
        const live = pruneSelection(selectionRef.current, key, ordered);
        if (live.paths.length > 0) {
            const chosen = new Set(live.paths);
            return orderedFiles.filter((file) =>
                chosen.has(pathKey(file.path)),
            );
        }
        const index = viewerIndexRef.current;
        return index !== null && orderedFiles[index]
            ? [orderedFiles[index]]
            : [];
    }

    function runFileAction(
        action: FileAction,
        files: ImageFile[],
        confirmed = false,
    ) {
        if (
            fileOperationRef.current ||
            !viewRef.current.path ||
            files.length === 0
        ) {
            return;
        }
        if (viewRef.current.serviceRole) {
            return;
        }
        if (
            action === 'move_to_local_trash' &&
            needsMoveConfirm(
                files.length,
                preferencesRef.current.confirmMove,
            ) &&
            !confirmed
        ) {
            setConfirmMove(files);
            return;
        }
        const id = operationId();
        const directory = viewRef.current.path;
        if (action === 'move_to_local_trash') {
            const conflict =
                favoritesCoordinatorRef.current.conflictForDirectory(
                    directory,
                );
            if (conflict.status === 'busy') {
                setFileNotice({
                    tone: 'failed',
                    text:
                        'Дождитесь завершения операции с избранным, затем повторите.',
                    details: [],
                });
                return;
            }
        }
        const silentFavorite =
            action === 'copy_to_local_favorites' && files.length === 1;
        const favoriteAddGenerations = new Map<string, number>();
        if (action === 'copy_to_local_favorites') {
            if (tryQueueFavoriteAdds(files, directory)) {
                syncFavoritesFolderPendingCreate(directory);
                bumpFavoriteAddQueueRevision();
                return;
            }
            syncFavoritesFolderPendingCreate(directory);
            bumpFavoriteAddQueueRevision();
            if (
                files.some((file) =>
                    isFavoriteOverlayBlockingAdd(
                        favoriteOverlayRef.current,
                        pathKey(file.path),
                    ),
                )
            ) {
                return;
            }
            const pendingBatch: {
                key: string;
                operationId: string;
                desired: boolean;
                generation: number;
            }[] = [];
            for (const file of files) {
                const key = pathKey(file.path);
                const generation = nextFavoriteOverlayGeneration(
                    favoriteOverlayGenerationsRef.current,
                    key,
                );
                favoriteOverlayGenerationsRef.current.set(key, generation);
                favoriteAddGenerations.set(key, generation);
                pendingBatch.push({
                    key,
                    operationId: id,
                    desired: true,
                    generation,
                });
            }
            setFavoriteOverlay((current) =>
                applyFavoriteOverlayPendingBatch(current, pendingBatch),
            );
        }
        fileOperationRef.current = { id, action, directory };
        if (action === 'copy_to_local_favorites') {
            favoritesCoordinatorRef.current.beginFileOperation({
                operationId: id,
                albumDirectory: directory,
            });
        }
        if (!silentFavorite) {
            setFileOperation({ id, action, directory });
            setFileProgress(null);
        }
        setFileNotice(null);
        let favoritePerf: FavoritePerfSession | null = null;
        if (action === 'copy_to_local_favorites') {
            favoritePerf = startFavoritePerfSession({
                operationId: id,
                fileCount: files.length,
                bytesTotal: sumFileBytes(files),
                channel: files.length > 1 ? 'selection' : 'direct',
            });
            favoritePerf.markIpcStart();
        }
        void invoke<FileOperationResult>('run_file_operation', {
            operationId: id,
            currentDirectory: directory,
            action,
            paths: files.map((file) => file.path),
        })
            .then((result) => {
                favoritePerf?.markIpcEnd();
                if (
                    !viewRef.current.path ||
                    pathKey(viewRef.current.path) !== pathKey(result.directory)
                ) {
                    if (action === 'copy_to_local_favorites') {
                        setFavoriteOverlay((current) =>
                            clearFavoriteOverlayForOperation(current, id),
                        );
                        favoritePerf?.finish('skipped');
                    }
                    return;
                }
                if (action === 'move_to_local_trash') {
                    const removed = new Set(
                        result.outcomes
                            .filter((item) => item.status === 'moved')
                            .map((item) => pathKey(item.sourcePath)),
                    );
                    const open =
                        viewerIndexRef.current !== null
                            ? orderedRef.current[viewerIndexRef.current]
                            : undefined;
                    if (
                        shouldStartPhotoFlip({
                            action,
                            requestedCount: files.length,
                            movedCount: removed.size,
                            rustFailed: false,
                        })
                    ) {
                        const viewport = photoGridViewportRef.current;
                        const first = captureVisiblePhotoRects(viewport);
                        if (first.length > 0) {
                            photoFlipGen.current += 1;
                            setPhotoFlip({
                                generation: photoFlipGen.current,
                                operationId: id,
                                directoryKey: viewRef.current.path
                                    ? pathKey(viewRef.current.path)
                                    : null,
                                layoutMode,
                                rowsPerScreen,
                                scrollTop: viewport?.scrollTop ?? 0,
                                first,
                            });
                        }
                    }
                    setView((current) => ({
                        ...current,
                        images: current.images.filter(
                            (file) => !removed.has(pathKey(file.path)),
                        ),
                    }));
                    setSelection((current) => ({
                        ...current,
                        paths: current.paths.filter(
                            (item) => !removed.has(item),
                        ),
                        anchor:
                            current.anchor && removed.has(current.anchor)
                                ? null
                                : current.anchor,
                    }));
                    if (open && removed.has(pathKey(open.path))) {
                        setViewerIndex(
                            viewerIndexAfterRemoval(
                                orderedRef.current.map((file) =>
                                    pathKey(file.path),
                                ),
                                viewerIndexRef.current,
                                removed,
                            ),
                        );
                    }
                }
                if (action === 'copy_to_local_favorites') {
                    // CL-P05: link/journal lag keeps status copied but sets favorite_link.
                    const journalIncompleteOutcomes = result.outcomes.filter(
                        (item) =>
                            (item.status === 'copied' ||
                                item.status === 'already_exists') &&
                            (item.errorCode === 'favorite_link' ||
                                item.errorCode === 'needs_reconciliation' ||
                                item.errorCode === 'ST_NEEDS_RECONCILIATION'),
                    );
                    const journalIncomplete = journalIncompleteOutcomes.length > 0;
                    const marked = result.outcomes
                        .filter(
                            (item) =>
                                (item.status === 'copied' ||
                                    item.status === 'already_exists') &&
                                !item.errorCode,
                        )
                        .map((item) => pathKey(item.sourcePath));
                    if (marked.length > 0) {
                        noteFavoritePathsConfirmedLocalMutation();
                        setFavoritePaths((current) => {
                            const next = new Set(current);
                            for (const key of marked) {
                                next.add(key);
                            }
                            return next;
                        });
                    }
                    if (journalIncomplete) {
                        setFavoriteOverlay((current) =>
                            rollbackIndeterminateFavoriteOverlay(
                                current,
                                journalIncompleteOutcomes.map((o) => o.sourcePath),
                            ),
                        );
                        if (directory) {
                            void fetchFavoriteOriginPaths(directory);
                        }
                    } else {
                        for (const item of result.outcomes) {
                            const key = pathKey(item.sourcePath);
                            const generation = favoriteAddGenerations.get(key);
                            if (generation === undefined) {
                                continue;
                            }
                            if (
                                isTerminalFavoriteAddOutcomeStatus(
                                    item.status,
                                )
                            ) {
                                setFavoriteOverlay((current) =>
                                    clearFavoriteOverlayIfGeneration(
                                        current,
                                        key,
                                        generation,
                                    ),
                                );
                            }
                        }
                    }
                    const summary = summarize(result.outcomes);
                    if (
                        favoriteNeedsReviewNotice({
                            journalIncomplete,
                            needsReconciliation: journalIncomplete,
                        })
                    ) {
                        const anyDiskOk = marked.length > 0;
                        setFileNotice(
                            anyDiskOk
                                ? favoritesPartialSuccessNotice()
                                : favoritesNeedsReviewNotice(),
                        );
                    } else {
                        const quietSuccess =
                            summary.failed === 0 &&
                            shouldAnnounceFullFavoriteSuccess(true, {
                                journalIncomplete: false,
                            });
                        if (!quietSuccess) {
                            setFileNotice(operationNotice(action, summary));
                        }
                    }
                    if (favoritePerf) {
                        const summary = summarize(result.outcomes);
                        const outcome =
                            summary.failed > 0 &&
                            summary.copied + summary.alreadyExists > 0
                                ? 'partial'
                                : summary.failed > 0
                                  ? 'failed'
                                  : 'completed';
                        favoritePerf.finish(outcome);
                        favoritePerf = null;
                    }
                    const addSummary = summarize(result.outcomes);
                    if (
                        addSummary.copied + addSummary.alreadyExists === 0 &&
                        addSummary.failed > 0
                    ) {
                        void tryCleanupEmptyFavoritesFolderAfterQueuedAdds(
                            directory,
                        );
                    }
                } else if (action === 'move_to_local_trash') {
                    const summary = summarize(result.outcomes);
                    if (summary.failed !== 0) {
                        setFileNotice(operationNotice(action, summary));
                    }
                } else {
                    const summary = summarize(result.outcomes);
                    setFileNotice(operationNotice(action, summary));
                }
                if (result.destinationFolder && result.destinationRole) {
                    const role = result.destinationRole;
                    const destKey = pathKey(result.destinationFolder);
                    const missing = !viewRef.current.folders.some(
                        (folder) => pathKey(folder.path) === destKey,
                    );
                    if (result.destinationCreated || missing) {
                        addServiceFolderToView(result.destinationFolder, role);
                    }
                }
                if (
                    action === 'move_to_local_trash' &&
                    result.destinationFolder
                ) {
                    forgetHotFolder(result.destinationFolder);
                }
                if (
                    action !== 'copy_to_local_favorites' &&
                    action !== 'move_to_local_trash'
                ) {
                    scheduleFolderRefreshRef.current(directory);
                }
            })
            .catch((error: unknown) => {
                favoritePerf?.markIpcEnd();
                if (action === 'copy_to_local_favorites') {
                    setFavoriteOverlay((current) =>
                        clearFavoriteOverlayForOperation(current, id),
                    );
                    // T044b / FR-008: без disk-truth нельзя объявлять «все failed».
                    const albumDirectory = directory;
                    if (
                        albumDirectory &&
                        viewRef.current.serviceRole !== 'favorites'
                    ) {
                        void (async () => {
                            const truth =
                                await refetchFavoriteOriginPathsAfterIpcFailure({
                                    directory: albumDirectory,
                                    fetchOriginPaths: (dir) =>
                                        invoke<string[]>('favorite_origin_paths', {
                                            directory: dir,
                                        }),
                                    isDirectorySessionCurrent: () =>
                                        !!viewRef.current.path &&
                                        pathKey(viewRef.current.path) ===
                                            pathKey(albumDirectory) &&
                                        viewRef.current.serviceRole !==
                                            'favorites',
                                });
                            if (truth.status === 'ok') {
                                const classified =
                                    classifyAttemptedFavoriteAddsAgainstDisk(
                                        files.map((file) => file.path),
                                        truth.originPaths,
                                    );
                                if (classified.confirmedOnDisk.length > 0) {
                                    noteFavoritePathsConfirmedLocalMutation();
                                    setFavoritePaths((current) => {
                                        const next = new Set(current);
                                        for (const path of classified.confirmedOnDisk) {
                                            next.add(pathKey(path));
                                        }
                                        return next;
                                    });
                                }
                                const tone = batchAddNoticeToneAfterDiskTruth({
                                    attempted: files.length,
                                    confirmedOnDisk:
                                        classified.confirmedOnDisk.length,
                                    diskTruthChecked: true,
                                });
                                if (tone === 'ok') {
                                    return;
                                }
                                if (tone === 'partial') {
                                    setFileNotice(
                                        favoritesPartialSuccessNotice(),
                                    );
                                    return;
                                }
                                setFileNotice({
                                    tone: 'failed',
                                    text: formatInvokeError(error),
                                    details: [],
                                });
                                void tryCleanupEmptyFavoritesFolderAfterQueuedAdds(
                                    albumDirectory,
                                );
                                return;
                            }
                            if (!mayAnnounceAllBatchFailed(false)) {
                                setFileNotice(favoritesNeedsReviewNotice());
                                if (
                                    truth.status !== 'stale_session' &&
                                    viewRef.current.path &&
                                    pathKey(viewRef.current.path) ===
                                        pathKey(albumDirectory)
                                ) {
                                    void fetchFavoriteOriginPaths(albumDirectory);
                                }
                            }
                        })();
                        return;
                    }
                }
                setFileNotice({
                    tone: 'failed',
                    text: formatInvokeError(error),
                    details: [],
                });
                favoritePerf?.finish('failed');
                favoritePerf = null;
            })
            .finally(() => {
                if (fileOperationRef.current?.id === id) {
                    fileOperationRef.current = null;
                }
                if (!silentFavorite) {
                    setFileOperation(null);
                    setFileProgress(null);
                }
                if (action === 'copy_to_local_favorites') {
                    favoritesCoordinatorRef.current.endFileOperation(id);
                    syncFavoritesFolderPendingCreate(directory);
                    bumpFavoriteAddQueueRevision();
                }
            });
    }

    async function refreshFolder(path: string) {
        if (Date.now() < suppressFolderRefreshUntilRef.current) {
            return;
        }
        if (isDeferredParentFolderRefresh(path)) {
            return;
        }
        const id = requestId.current;
        const keptScroll = scrollTopRef.current;
        listingRescanRef.current = true;
        folderListingBusyRef.current = true;
        setFolderListingBusy(true);
        beginFolderThumbProgress(id);
        seedFolderThumbProgress(id, viewRef.current.images);
        try {
            const next = await browseDirectory(path, id);
            if (
                requestId.current !== id ||
                !viewRef.current.path ||
                pathKey(viewRef.current.path) !== pathKey(path)
            ) {
                return;
            }
            const open =
                viewerIndexRef.current !== null
                    ? orderedRef.current[viewerIndexRef.current]
                    : undefined;
            const previous = viewRef.current.images;
            const previousByKey = new Map(
                previous.map((file) => [pathKey(file.path), file]),
            );
            const mergedImages = next.images.map((file) => {
                const old = previousByKey.get(pathKey(file.path));
                if (
                    old &&
                    old.size === file.size &&
                    old.modifiedAt === file.modifiedAt
                ) {
                    return old;
                }
                return file;
            });
            retainUnchanged(
                previous,
                mergedImages,
                metaRef.current,
                thumbsRef.current,
                failedRef.current,
            );
            setMetaVersion((value) => value + 1);
            setThumbVersion((value) => value + 1);
            setFailedVersion((value) => value + 1);
            setView(withLocalizedDirectory({ ...next, images: mergedImages }));
            seedFolderThumbProgress(id, mergedImages);
            if (keptScroll > 0) {
                scrollRestoreToken.current += 1;
                setScrollRestore({
                    token: scrollRestoreToken.current,
                    top: keptScroll,
                });
            }
            if (open) {
                const nextOrdered = sortPhotos(
                    next.images,
                    gallerySortRef.current,
                );
                const exact = nextOrdered.findIndex(
                    (file) => pathKey(file.path) === pathKey(open.path),
                );
                if (exact >= 0) {
                    setViewerIndex(exact);
                } else {
                    const removed = new Set(
                        orderedRef.current
                            .map((file) => pathKey(file.path))
                            .filter(
                                (item) =>
                                    !next.images.some(
                                        (file) => pathKey(file.path) === item,
                                    ),
                            ),
                    );
                    const neighbor = viewerIndexAfterRemoval(
                        orderedRef.current.map((file) => pathKey(file.path)),
                        viewerIndexRef.current,
                        removed,
                    );
                    setViewerIndex(
                        neighbor === null
                            ? null
                            : Math.min(
                                  neighbor,
                                  Math.max(0, nextOrdered.length - 1),
                              ),
                    );
                }
            }
            const sorted = sortPhotos(next.images, gallerySortRef.current);
            const nextPaths = sorted.map((file) => file.path);
            const changed = !samePathList(indexedPathsRef.current, nextPaths);
            if (changed && next.path) {
                indexedPathsRef.current = nextPaths;
                await startIndexing(next.path, sorted, id);
                reportGeometryRange(sorted.length);
                if (
                    open &&
                    next.images.some(
                        (file) => pathKey(file.path) === pathKey(open.path),
                    )
                ) {
                    await invoke('set_viewer', { path: open.path });
                }
            }
            if (next.path && next.serviceRole !== 'favorites') {
                void fetchFavoriteOriginPaths(next.path);
            }
        } catch (error: unknown) {
            if (
                requestId.current !== id ||
                !viewRef.current.path ||
                pathKey(viewRef.current.path) !== pathKey(path)
            ) {
                return;
            }
            const parent = viewRef.current.parent;
            if (parent && browseErrorLooksLikeMissingFolder(error)) {
                void loadImplRef.current(parent, true);
                return;
            }
            setFileNotice({
                tone: 'failed',
                text: formatInvokeError(error),
                details: [],
            });
        } finally {
            if (requestId.current === id) {
                listingRescanRef.current = false;
                folderListingBusyRef.current = false;
                setFolderListingBusy(false);
                syncFolderThumbnailsPending();
            }
        }
    }

    async function undoFavoriteRemovals(ids: string[]) {
        // FR-006: in-app undo — заглушка; восстановление через корзину Windows.
        const errors: string[] = [];
        for (const id of ids) {
            try {
                await invoke('undo_favorite_removal', { id });
            } catch (error: unknown) {
                errors.push(
                    formatInvokeError(error),
                );
            }
        }
        const directory = viewRef.current.path;
        if (directory) {
            scheduleFolderRefreshRef.current(directory);
            if (viewRef.current.serviceRole !== 'favorites') {
                void fetchFavoriteOriginPaths(directory);
            }
        }
        setFileNotice({
            tone: errors.length > 0 ? 'failed' : 'ok',
            text:
                errors.length > 0
                    ? t('selection.favoriteReturnFailed')
                    : t('selection.favoriteReturned'),
            details: errors.slice(0, 5),
        });
    }

    async function restoreFiles(files: ImageFile[]) {
        for (const file of files) {
            const key = pathKey(file.path);
            markBusy([key], true);
            try {
                const restoredResult = await invoke<RestoreTrashResult>(
                    'restore_local_trash',
                    {
                        path: file.path,
                        mode: 'parent',
                        chosenDirectory: null,
                    },
                );
                applyRemovedServiceFolder(restoredResult.removedServiceFolder);
                const removed = new Set([key]);
                setView((current) => ({
                    ...current,
                    images: current.images.filter(
                        (item) => pathKey(item.path) !== key,
                    ),
                }));
                if (viewerIndexRef.current !== null) {
                    setViewerIndex(
                        viewerIndexAfterRemoval(
                            orderedRef.current.map((item) =>
                                pathKey(item.path),
                            ),
                            viewerIndexRef.current,
                            removed,
                        ),
                    );
                }
            } catch (error: unknown) {
                const message =
                    formatInvokeError(error);
                markBusy([key], false);
                if (message === 'name_taken' || message === 'origin_missing') {
                    setRestorePrompt({ file, code: message });
                } else {
                    setFileNotice({
                        tone: 'failed',
                        text: message,
                        details: [],
                    });
                }
                return;
            }
            markBusy([key], false);
        }
    }

    async function syncDisplayRotations(paths: string[]) {
        if (paths.length === 0) {
            return;
        }
        try {
            const items = await invoke<{ path: string; quarters: number }[]>(
                'list_display_rotations',
                { paths },
            );
            for (const item of items) {
                const prev = metaRef.current.get(item.path) ?? {
                    width: 0,
                    height: 0,
                };
                metaRef.current.set(item.path, {
                    ...prev,
                    rotationQuarters: item.quarters,
                });
            }
            setMetaVersion((value) => value + 1);
        } catch {
            // ignore
        }
    }

    async function rotateDisplayClockwise(file: ImageFile) {
        try {
            const quarters = await invoke<number>('rotate_display_clockwise', {
                path: file.path,
            });
            const prev = metaRef.current.get(file.path) ?? {
                width: 0,
                height: 0,
            };
            metaRef.current.set(file.path, {
                ...prev,
                rotationQuarters: quarters,
            });
            setMetaVersion((value) => value + 1);
            stashOpenFolder();
        } catch {
            // ignore
        }
    }

    const fileActions = (
        photoToggle: { selected: boolean; onToggle: () => void } | null,
    ) => (
        <SelectionActions
            embedded={false}
            count={targetFiles.length}
            canClear={liveSelection.paths.length > 0}
            deleteReason={commandsAvailable.deleteReason}
            deleteHint={t('selection.deleteHint')}
            favoriteReason={commandsAvailable.favoriteReason}
            restoreReason={commandsAvailable.restoreReason}
            showDelete={!inFavorites}
            showRestore={false}
            unfavoriteMode={inFavorites}
            progressLabel={fileProgressText}
            reserveProgressWidth={fileOperation !== null}
            reserveProgressWithBytes={
                fileOperation?.action === 'copy_to_local_favorites'
            }
            showCancel={fileOperation !== null}
            photoToggle={photoToggle}
            onClear={() => setSelection(clearSelectionPaths(directoryKey))}
            onDelete={() => {
                runFileAction('move_to_local_trash', targetFiles);
            }}
            onFavorite={() => {
                if (inFavorites) {
                    void removeSelectedFromFavorites(targetFiles);
                    return;
                }
                runFileAction('copy_to_local_favorites', targetFiles);
            }}
            onRestore={() => {
                void restoreFiles(targetFiles);
            }}
            onCancel={() => {
                if (fileOperation) {
                    void invoke('cancel_file_operation', {
                        operationId: fileOperation.id,
                    });
                }
            }}
        />
    );

    function pathsConflictWithUnfavoriteLock(
        files: readonly ImageFile[],
    ): boolean {
        if (lockedUnfavoritePathsRef.current.size === 0) {
            return false;
        }
        return files.some((file) =>
            lockedUnfavoritePathsRef.current.has(pathKey(file.path)),
        );
    }

    function lockUnfavoritePaths(files: readonly ImageFile[]) {
        for (const file of files) {
            lockedUnfavoritePathsRef.current.add(pathKey(file.path));
        }
    }

    function unlockUnfavoritePaths(files: readonly ImageFile[]) {
        for (const file of files) {
            lockedUnfavoritePathsRef.current.delete(pathKey(file.path));
        }
    }

    function markBusy(paths: string[], busy: boolean) {
        setBusyPaths((current) => {
            const next = new Set(current);
            for (const item of paths) {
                if (busy) {
                    next.add(item);
                } else {
                    next.delete(item);
                }
            }
            return next;
        });
    }

    function viewerShowsFile(file: ImageFile): boolean {
        const index = viewerIndexRef.current;
        if (index === null) {
            return false;
        }
        const open = orderedRef.current[index];
        return open !== undefined && pathKey(open.path) === pathKey(file.path);
    }

    function startFavoriteStarOverlay(
        key: string,
        desired: boolean,
        opId: string,
    ): number {
        const generations = commitFavoriteStarOverlayBatch([
            { key, desired, operationId: opId },
        ]);
        return generations.get(key) ?? 0;
    }

    async function coordinatorFinishFilesystemSession(sessionId: string) {
        const scope =
            favoritesCoordinatorRef.current.endMassUnfavorite(sessionId);
        if (scope) {
            await drainFavoriteAddQueue(scope);
            syncFavoritesFolderPendingCreate(
                viewRef.current.path &&
                    viewRef.current.serviceRole !== 'favorites'
                    ? viewRef.current.path
                    : scope,
            );
            bumpFavoriteAddQueueRevision();
        }
    }

    function resolveImageFileForIntent(photoKey: string): ImageFile | null {
        const key = pathKey(photoKey);
        const fromView = viewRef.current.images.find(
            (file) => pathKey(file.path) === key,
        );
        if (fromView) {
            return fromView;
        }
        const fromOrdered = orderedRef.current.find(
            (file) => pathKey(file.path) === key,
        );
        return fromOrdered ?? null;
    }

    function resolveQueuedFavoriteAddGeneration(
        intent: FavoriteAddIntent,
    ): number | undefined {
        let generation = favoriteOverlayGenerationsRef.current.get(
            intent.photoKey,
        );
        if (
            generation === undefined &&
            !isFavoriteOverlayPending(
                favoriteOverlayRef.current,
                intent.photoKey,
            )
        ) {
            generation = startFavoriteStarOverlay(
                intent.photoKey,
                true,
                intent.overlayOperationId,
            );
        }
        if (generation === undefined) {
            const entry = favoriteOverlayRef.current.get(intent.photoKey);
            generation = entry?.generation ?? 0;
        }
        return generation;
    }

    function favoriteOutcomeToExecutorResult(
        status: string,
        errorCode?: string | null,
    ): FavoriteAddExecutorResult {
        if (status === 'copied' || status === 'already_exists') {
            if (
                errorCode === 'favorite_link' ||
                errorCode === 'needs_reconciliation' ||
                errorCode === 'ST_NEEDS_RECONCILIATION'
            ) {
                return 'failed';
            }
            return 'completed';
        }
        if (status === 'cancelled') {
            return 'skipped';
        }
        return 'failed';
    }

    async function applyQueuedFavoriteAddIpcSuccess(
        result: FileOperationResult,
        entries: ReadonlyArray<{
            intent: FavoriteAddIntent;
            file: ImageFile;
            generation: number;
        }>,
    ): Promise<Record<string, FavoriteAddExecutorResult>> {
        const directory = entries[0]?.intent.albumDirectory ?? result.directory;
        const results: Record<string, FavoriteAddExecutorResult> = {};
        if (
            !viewRef.current.path ||
            pathKey(viewRef.current.path) !== pathKey(result.directory)
        ) {
            for (const entry of entries) {
                rollbackFavoriteStarOverlay(
                    entry.intent.photoKey,
                    entry.generation,
                );
                results[entry.intent.photoKey] = 'skipped';
            }
            return results;
        }
        if (result.destinationFolder && result.destinationRole) {
            const destKey = pathKey(result.destinationFolder);
            const missing = !viewRef.current.folders.some(
                (folder) => pathKey(folder.path) === destKey,
            );
            if (result.destinationCreated || missing) {
                addServiceFolderToView(
                    result.destinationFolder,
                    result.destinationRole,
                );
            }
        }
        const journalIncompleteOutcomes = result.outcomes.filter(
            (item) =>
                (item.status === 'copied' ||
                    item.status === 'already_exists') &&
                (item.errorCode === 'favorite_link' ||
                    item.errorCode === 'needs_reconciliation' ||
                    item.errorCode === 'ST_NEEDS_RECONCILIATION'),
        );
        const journalIncomplete = journalIncompleteOutcomes.length > 0;
        const marked: string[] = [];
        for (const item of result.outcomes) {
            const key = pathKey(item.sourcePath);
            const executorResult = favoriteOutcomeToExecutorResult(
                item.status,
                item.errorCode,
            );
            results[key] = executorResult;
            if (executorResult === 'completed') {
                marked.push(key);
            }
        }
        for (const entry of entries) {
            const key = pathKey(entry.intent.photoKey);
            if (results[key] === undefined) {
                results[key] = 'failed';
            }
            results[entry.intent.photoKey] = results[key];
        }
        if (marked.length > 0) {
            noteFavoritePathsConfirmedLocalMutation();
            setFavoritePaths((current) => {
                const next = new Set(current);
                for (const key of marked) {
                    next.add(key);
                }
                return next;
            });
        }
        if (journalIncomplete) {
            setFavoriteOverlay((current) =>
                rollbackIndeterminateFavoriteOverlay(
                    current,
                    journalIncompleteOutcomes.map((o) => o.sourcePath),
                ),
            );
            if (directory) {
                void fetchFavoriteOriginPaths(directory);
            }
        } else {
            for (const entry of entries) {
                const key = pathKey(entry.intent.photoKey);
                const item = result.outcomes.find(
                    (row) => pathKey(row.sourcePath) === key,
                );
                if (!item) {
                    continue;
                }
                const executorResult = results[key];
                if (
                    executorResult === 'completed' ||
                    executorResult === 'failed' ||
                    executorResult === 'skipped'
                ) {
                    rollbackFavoriteStarOverlay(key, entry.generation);
                }
            }
        }
        const summary = summarize(result.outcomes);
        if (
            favoriteNeedsReviewNotice({
                journalIncomplete,
                needsReconciliation: journalIncomplete,
            })
        ) {
            const anyDiskOk = marked.length > 0;
            setFileNotice(
                anyDiskOk
                    ? favoritesPartialSuccessNotice()
                    : favoritesNeedsReviewNotice(),
            );
        } else if (summary.failed > 0) {
            setFileNotice(
                operationNotice('copy_to_local_favorites', summary),
            );
        }
        return results;
    }

    async function executeQueuedFavoriteAddDrain(
        intents: readonly FavoriteAddIntent[],
    ): Promise<FavoriteAddDrainResult> {
        if (intents.length === 0) {
            return { kind: 'ok', results: {} };
        }
        const directory = intents[0].albumDirectory;
        if (
            favoritesCoordinatorRef.current.conflictForDirectory(directory)
                .status === 'busy'
        ) {
            const busyResults: Record<string, FavoriteAddExecutorResult> = {};
            for (const intent of intents) {
                busyResults[intent.photoKey] = 'retry_conflict';
            }
            return { kind: 'ok', results: busyResults };
        }
        const entries: {
            intent: FavoriteAddIntent;
            file: ImageFile;
            generation: number;
        }[] = [];
        const skipped: Record<string, FavoriteAddExecutorResult> = {};
        for (const intent of intents) {
            const live = favoritesCoordinatorRef.current.getIntent(
                intent.photoKey,
            );
            if (!live?.desired) {
                skipped[intent.photoKey] = 'skipped';
                continue;
            }
            const file = resolveImageFileForIntent(intent.photoKey);
            if (!file) {
                skipped[intent.photoKey] = 'skipped';
                continue;
            }
            const generation = resolveQueuedFavoriteAddGeneration(intent);
            if (generation === undefined) {
                skipped[intent.photoKey] = 'skipped';
                continue;
            }
            entries.push({ intent, file, generation });
        }
        if (entries.length === 0) {
            return { kind: 'ok', results: skipped };
        }
        const batchOperationId = operationId();
        let queueWaitMs = 0;
        for (const entry of entries) {
            queueWaitMs = Math.max(
                queueWaitMs,
                consumeFavoriteAddQueueWait(entry.intent.photoKey),
            );
        }
        const favoritePerf = startFavoritePerfSession({
            operationId: batchOperationId,
            fileCount: entries.length,
            bytesTotal: sumFileBytes(entries.map((entry) => entry.file)),
            channel: 'queued',
            queueWaitMs,
        });
        favoritesCoordinatorRef.current.beginFileOperation({
            operationId: batchOperationId,
            albumDirectory: directory,
        });
        fileOperationRef.current = {
            id: batchOperationId,
            action: 'copy_to_local_favorites',
            directory,
        };
        setFileOperation({
            id: batchOperationId,
            action: 'copy_to_local_favorites',
            directory,
        });
        setFileProgress(null);
        setFileNotice(null);
        try {
            favoritePerf.markIpcStart();
            const result = await invoke<FileOperationResult>(
                'run_file_operation',
                {
                    operationId: batchOperationId,
                    currentDirectory: directory,
                    action: 'copy_to_local_favorites',
                    paths: entries.map((entry) => entry.file.path),
                },
            );
            favoritePerf.markIpcEnd();
            const applied = await applyQueuedFavoriteAddIpcSuccess(
                result,
                entries,
            );
            const merged = { ...skipped, ...applied };
            const summary = summarize(result.outcomes);
            const outcome =
                summary.failed > 0 &&
                summary.copied + summary.alreadyExists > 0
                    ? 'partial'
                    : summary.failed > 0
                      ? 'failed'
                      : 'completed';
            favoritePerf.finish(outcome);
            return { kind: 'ok', results: merged };
        } catch (error: unknown) {
            favoritePerf.markIpcEnd();
            const message = formatInvokeError(error);
            if (isTemporaryFilesystemConflictMessage(message)) {
                favoritePerf.finish('skipped');
                if (entries.length === 1) {
                    return {
                        kind: 'ok',
                        results: {
                            [entries[0].intent.photoKey]: 'retry_conflict',
                        },
                    };
                }
                return { kind: 'pre_start_conflict' };
            }
            const truth = await refetchFavoriteOriginPathsAfterIpcFailure({
                directory,
                fetchOriginPaths: (dir) =>
                    invoke<string[]>('favorite_origin_paths', {
                        directory: dir,
                    }),
                isDirectorySessionCurrent: () =>
                    !!viewRef.current.path &&
                    pathKey(viewRef.current.path) === pathKey(directory) &&
                    viewRef.current.serviceRole !== 'favorites',
            });
            const failedResults: Record<string, FavoriteAddExecutorResult> = {
                ...skipped,
            };
            if (truth.status === 'ok') {
                const classified = classifyAttemptedFavoriteAddsAgainstDisk(
                    entries.map((entry) => entry.file.path),
                    truth.originPaths,
                );
                const confirmed = new Set(
                    classified.confirmedOnDisk.map((path) => pathKey(path)),
                );
                for (const entry of entries) {
                    const key = entry.intent.photoKey;
                    if (confirmed.has(key)) {
                        noteFavoritePathsConfirmedLocalMutation();
                        setFavoritePaths((current) => {
                            const next = new Set(current);
                            next.add(key);
                            return next;
                        });
                        rollbackFavoriteStarOverlay(key, entry.generation);
                        failedResults[key] = 'completed';
                    } else {
                        rollbackFavoriteStarOverlay(key, entry.generation);
                        failedResults[key] = 'failed';
                    }
                }
                const tone = batchAddNoticeToneAfterDiskTruth({
                    attempted: entries.length,
                    confirmedOnDisk: classified.confirmedOnDisk.length,
                    diskTruthChecked: true,
                });
                if (tone === 'partial') {
                    setFileNotice(favoritesPartialSuccessNotice());
                } else if (tone === 'failed') {
                    setFileNotice({
                        tone: 'failed',
                        text: message,
                        details: [],
                    });
                }
            } else {
                for (const entry of entries) {
                    rollbackFavoriteStarOverlay(
                        entry.intent.photoKey,
                        entry.generation,
                    );
                    failedResults[entry.intent.photoKey] = 'failed';
                }
                setFileNotice({
                    tone: 'failed',
                    text: message,
                    details: [],
                });
            }
            favoritePerf.finish('failed');
            return { kind: 'ok', results: failedResults };
        } finally {
            if (fileOperationRef.current?.id === batchOperationId) {
                fileOperationRef.current = null;
            }
            setFileOperation(null);
            setFileProgress(null);
            favoritesCoordinatorRef.current.endFileOperation(batchOperationId);
            syncFavoritesFolderPendingCreate(directory);
            bumpFavoriteAddQueueRevision();
        }
    }

    function resolveParentDirectoryForAlbumScope(
        albumScope: string,
    ): string | null {
        const current = viewRef.current.path;
        if (
            current &&
            viewRef.current.serviceRole !== 'favorites' &&
            pathKey(current).toLowerCase() === albumScope.toLowerCase()
        ) {
            return current;
        }
        return null;
    }

    async function tryCleanupEmptyFavoritesFolderAfterQueuedAdds(
        parentDirectory: string,
    ) {
        if (
            !shouldAttemptEmptyFavoritesCleanup({
                parentDirectory,
                serviceRole: viewRef.current.serviceRole,
                hasActiveAddIntents:
                    favoritesCoordinatorRef.current.hasActiveAddIntentsForDirectory(
                        parentDirectory,
                    ),
                copyToFavoritesInFlight: fileOperationIsCopyToFavoritesInDirectory(
                    fileOperationRef.current,
                    parentDirectory,
                ),
            })
        ) {
            return;
        }
        const folderPath = predictFavoritesServiceFolderPath(
            parentDirectory,
            optimisticFavoritesFolderHideRef.current,
        );
        const outcome = await cleanupEmptyServiceFolder(
            parentDirectory,
            folderPath,
        );
        if (outcome.status === 'removed' && outcome.location) {
            applyRemovedServiceFolder(outcome.location);
        }
        syncFavoritesFolderPendingCreate(parentDirectory);
        bumpFavoriteAddQueueRevision();
    }

    async function drainFavoriteAddQueue(albumScope: string) {
        await favoritesCoordinatorRef.current.drainQueuedAdds(
            albumScope,
            (intents) => executeQueuedFavoriteAddDrain(intents),
        );
        const parent = resolveParentDirectoryForAlbumScope(albumScope);
        if (parent) {
            await tryCleanupEmptyFavoritesFolderAfterQueuedAdds(parent);
        }
    }

    function tryQueueFavoriteAdds(
        files: readonly ImageFile[],
        directory: string,
    ): boolean {
        if (
            favoritesCoordinatorRef.current.conflictForDirectory(directory)
                .status === 'free'
        ) {
            return false;
        }
        const overlayOperationId = operationId();
        const pendingBatch: {
            key: string;
            operationId: string;
            desired: boolean;
            generation: number;
        }[] = [];
        for (const file of files) {
            const key = pathKey(file.path);
            if (
                isFavoriteOverlayBlockingAdd(favoriteOverlayRef.current, key)
            ) {
                continue;
            }
            const generation = nextFavoriteOverlayGeneration(
                favoriteOverlayGenerationsRef.current,
                key,
            );
            favoriteOverlayGenerationsRef.current.set(key, generation);
            pendingBatch.push({
                key,
                operationId: overlayOperationId,
                desired: true,
                generation,
            });
            favoritesCoordinatorRef.current.upsertAddIntent({
                intentId: operationId(),
                photoKey: key,
                photoPath: file.path,
                albumDirectory: directory,
                overlayOperationId,
                desired: true,
            });
            noteFavoriteAddQueued(key);
        }
        if (pendingBatch.length === 0) {
            return false;
        }
        setFavoriteOverlay((current) =>
            applyFavoriteOverlayPendingBatch(current, pendingBatch),
        );
        syncFavoritesFolderPendingCreate(directory);
        bumpFavoriteAddQueueRevision();
        return true;
    }

    function cancelQueuedFavoriteAdd(key: string) {
        const intent = favoritesCoordinatorRef.current.getIntent(key);
        if (!intent || intent.status !== 'queued') {
            return false;
        }
        favoritesCoordinatorRef.current.upsertAddIntent({
            intentId: operationId(),
            photoKey: key,
            photoPath: intent.photoPath,
            albumDirectory: intent.albumDirectory,
            overlayOperationId: intent.overlayOperationId,
            desired: false,
        });
        setFavoriteOverlay((current) =>
            clearFavoriteOverlayForOperation(
                current,
                intent.overlayOperationId,
            ),
        );
        syncFavoritesFolderPendingCreate(intent.albumDirectory);
        bumpFavoriteAddQueueRevision();
        void tryCleanupEmptyFavoritesFolderAfterQueuedAdds(
            intent.albumDirectory,
        );
        return true;
    }

    function commitFavoriteStarOverlayBatch(
        entries: ReadonlyArray<{
            key: string;
            desired: boolean;
            operationId: string;
        }>,
    ): Map<string, number> {
        const generations = new Map<string, number>();
        const filtered = filterMassUnfavoriteStarOverlayEntries(
            favoriteOverlayRef.current,
            entries,
        );
        if (filtered.length === 0) {
            return generations;
        }
        const pendingBatch = filtered.map(({ key, desired, operationId }) => {
            const generation = nextFavoriteOverlayGeneration(
                favoriteOverlayGenerationsRef.current,
                key,
            );
            favoriteOverlayGenerationsRef.current.set(key, generation);
            generations.set(key, generation);
            return { key, operationId, desired, generation };
        });
        setFavoriteOverlay((current) =>
            applyFavoriteOverlayPendingBatch(current, pendingBatch),
        );
        return generations;
    }

    function favoritePathsApplyGuardState() {
        const path = viewRef.current.path;
        const role = viewRef.current.serviceRole;
        const counters = favoritePathsSyncRef.current;
        return {
            latestRequestId: counters.latestRequestId,
            revision: counters.revision,
            openDirectoryKey:
                path && role !== 'favorites' ? pathKey(path) : null,
        };
    }

    function noteFavoritePathsConfirmedLocalMutation() {
        bumpFavoritePathsConfirmedRevision(favoritePathsSyncRef.current);
    }

    function consumeFavoritePathsFetchResult(
        ticket: ReturnType<typeof beginFavoritePathsFetch>,
        paths: readonly string[],
    ) {
        const resolved = resolveFavoritePathsFetch(
            ticket,
            favoritePathsApplyGuardState(),
            paths,
            favoriteOverlayRef.current,
        );
        if (resolved.applied && resolved.confirmed) {
            setFavoritePaths(resolved.confirmed);
            return;
        }
        if (
            needsFavoritePathsResyncAfterStaleReject(
                ticket,
                favoritePathsApplyGuardState(),
            )
        ) {
            const directory = viewRef.current.path;
            if (directory && viewRef.current.serviceRole !== 'favorites') {
                void fetchFavoriteOriginPaths(directory);
            }
        }
    }

    function fetchFavoriteOriginPaths(directory: string) {
        const ticket = beginFavoritePathsFetch(
            favoritePathsSyncRef.current,
            directory,
        );
        return invoke<string[]>('favorite_origin_paths', { directory })
            .then((paths) => {
                consumeFavoritePathsFetchResult(ticket, paths);
            })
            .catch(() => {
                const state = favoritePathsApplyGuardState();
                const resolved = resolveFavoritePathsFetch(
                    ticket,
                    state,
                    [],
                    favoriteOverlayRef.current,
                );
                if (resolved.applied) {
                    setFavoritePaths(new Set());
                } else if (
                    needsFavoritePathsResyncAfterStaleReject(ticket, state)
                ) {
                    void fetchFavoriteOriginPaths(directory);
                }
            });
    }

    function isDeferredParentFolderRefresh(path: string): boolean {
        const hide = optimisticFavoritesFolderHideRef.current;
        const gate = unfavoriteGateRef.current;
        if (!hide || !gate.busy || hide.operationId !== gate.sessionId) {
            return false;
        }
        return pathKey(path) === pathKey(hide.parentDirectory);
    }

    function rollbackFavoriteStarOverlay(key: string, generation: number) {
        setFavoriteOverlay((current) =>
            clearFavoriteOverlayIfGeneration(current, key, generation),
        );
        const live = favoriteOverlayRef.current.get(key);
        if (!live || live.generation === generation) {
            favoriteOverlayGenerationsRef.current.delete(key);
        }
    }

    function teardownMassUnfavoritePresentation(sessionId: string) {
        const session = massUnfavoriteOriginRef.current;
        if (!session || session.sessionId !== sessionId) {
            return;
        }
        const intents = favoritesCoordinatorRef.current.snapshotIntents();
        for (const [key, generation] of session.copyGenerations) {
            if (
                shouldPreserveFavoritePathDuringMassUnfavorite(
                    key,
                    favoriteOverlayRef.current,
                    intents,
                )
            ) {
                continue;
            }
            rollbackFavoriteStarOverlay(key, generation);
        }
        session.copyGenerations.clear();
        for (const [key, generation] of session.originGenerations) {
            if (
                shouldPreserveFavoritePathDuringMassUnfavorite(
                    key,
                    favoriteOverlayRef.current,
                    intents,
                )
            ) {
                continue;
            }
            rollbackFavoriteStarOverlay(key, generation);
        }
        session.originGenerations.clear();
    }

    function beginMassUnfavoriteOriginSession(
        sessionId: string,
        favoritesPath: string,
    ) {
        ensureFavoriteCopyOriginCacheScope(
            favoriteCopyOriginCacheRef.current,
            favoritesPath,
            favoriteCopyOriginCacheScopeRef,
        );
        massUnfavoriteOriginRef.current = {
            sessionId,
            sessionFavoritesPath: favoritesPath,
            copyToOrigin: new Map(),
            originGenerations: new Map(),
            copyGenerations: new Map(),
        };
    }

    function applyMassUnfavoriteOriginOverlays(
        sessionId: string,
        rows: FavoriteCopyOrigin[],
    ) {
        const session = massUnfavoriteOriginRef.current;
        if (!session || session.sessionId !== sessionId) {
            return;
        }
        ensureFavoriteCopyOriginCacheScope(
            favoriteCopyOriginCacheRef.current,
            session.sessionFavoritesPath,
            favoriteCopyOriginCacheScopeRef,
        );
        mergeFavoriteCopyOriginCache(favoriteCopyOriginCacheRef.current, rows);
        const links = mapSnapshotCopyOrigins(rows);
        const originBatch: {
            key: string;
            desired: boolean;
            operationId: string;
        }[] = [];
        for (const [copyKey, originKey] of links) {
            session.copyToOrigin.set(copyKey, originKey);
            if (session.originGenerations.has(originKey)) {
                continue;
            }
            originBatch.push({
                key: originKey,
                desired: false,
                operationId: sessionId,
            });
        }
        if (originBatch.length > 0) {
            const intents = favoritesCoordinatorRef.current.snapshotIntents();
            const generations = commitFavoriteStarOverlayBatch(originBatch);
            for (const entry of originBatch) {
                const generation = generations.get(entry.key);
                if (generation !== undefined) {
                    session.originGenerations.set(entry.key, generation);
                }
            }
            setFavoritePaths((current) => {
                const next = new Set(current);
                for (const entry of originBatch) {
                    if (
                        shouldPreserveFavoritePathDuringMassUnfavorite(
                            entry.key,
                            favoriteOverlayRef.current,
                            intents,
                        )
                    ) {
                        continue;
                    }
                    next.delete(entry.key);
                }
                return next;
            });
        }
    }

    function applyInstantMassUnfavoritePresentation(
        sessionId: string,
        targets: ImageFile[],
    ) {
        const session = massUnfavoriteOriginRef.current;
        if (!session || session.sessionId !== sessionId) {
            return;
        }
        const cache = favoriteCopyOriginCacheRef.current;
        const rows = copyOriginRowsFromCache(
            cache,
            targets.map((file) => file.path),
        );
        const copyBatch = targets.map((file) => ({
            key: pathKey(file.path),
            desired: false as const,
            operationId: sessionId,
        }));
        const copyGenerations = commitFavoriteStarOverlayBatch(copyBatch);
        for (const entry of copyBatch) {
            const generation = copyGenerations.get(entry.key);
            if (generation !== undefined) {
                session.copyGenerations.set(entry.key, generation);
            }
        }
        const intents = favoritesCoordinatorRef.current.snapshotIntents();
        const pathsOff = new Set(copyBatch.map((entry) => entry.key));
        for (const row of rows) {
            if (!row.originPath) {
                continue;
            }
            pathsOff.add(pathKey(row.originPath));
        }
        if (pathsOff.size > 0) {
            setFavoritePaths((current) => {
                const next = new Set(current);
                for (const key of pathsOff) {
                    if (
                        shouldPreserveFavoritePathDuringMassUnfavorite(
                            key,
                            favoriteOverlayRef.current,
                            intents,
                        )
                    ) {
                        continue;
                    }
                    next.delete(key);
                }
                return next;
            });
            const dirKey = viewRef.current.path
                ? pathKey(viewRef.current.path)
                : null;
            setSelection((current) =>
                removePathsFromSelection(current, dirKey, pathsOff),
            );
        }
        applyMassUnfavoriteOriginOverlays(sessionId, rows);
        const missing = targets.filter(
            (file) => !cache.has(pathKey(file.path)),
        );
        if (missing.length > 0) {
            favoriteOriginLookupPendingRef.current += 1;
            void invoke<FavoriteCopyOrigin[]>('favorite_origins_for_copies', {
                paths: missing.map((file) => file.path),
            })
                .then((fetched) => {
                    if (
                        massUnfavoriteOriginRef.current?.sessionId !==
                        sessionId
                    ) {
                        return;
                    }
                    applyMassUnfavoriteOriginOverlays(sessionId, fetched);
                })
                .catch(() => undefined)
                .finally(() => {
                    favoriteOriginLookupPendingRef.current = Math.max(
                        0,
                        favoriteOriginLookupPendingRef.current - 1,
                    );
                });
        }
    }

    function beginOptimisticFavoritesFolderHide(
        sessionId: string,
        folderPath: string,
        parentDirectory: string,
    ) {
        const generation = nextFavoritesFolderHideGeneration(
            favoritesFolderHideGenerationsRef.current,
            folderPath,
        );
        favoritesFolderHideGenerationsRef.current.set(
            pathKey(folderPath),
            generation,
        );
        optimisticFavoritesFolderHideRef.current = {
            operationId: sessionId,
            generation,
            folderPath,
            parentDirectory,
        };
        setOptimisticHiddenFolderKeys(new Set([pathKey(folderPath)]));
    }

    function cancelPendingFolderExitAnimation() {
        window.clearTimeout(folderCollapseTimerRef.current);
        folderCollapseTimerRef.current = 0;
        setFolderExitingKey(null);
        setFolderHeaderMorph(false);
    }

    function clearOptimisticFavoritesFolderHide(sessionId: string) {
        const hide = optimisticFavoritesFolderHideRef.current;
        if (!hide || hide.operationId !== sessionId) {
            return;
        }
        logMassUnfavoriteDiag({
            stage: 'clear_optimistic_hide',
            operationId: sessionId,
        });
        const current = viewRef.current;
        const onParent =
            current.path &&
            pathKey(current.path) === pathKey(hide.parentDirectory);
        optimisticFavoritesFolderHideRef.current = null;
        setOptimisticHiddenFolderKeys(new Set());
        setMassUnfavoriteExitingFavorites(false);
        massUnfavoriteOptimisticParentNavRef.current = null;
        cancelPendingFolderExitAnimation();
        if (onParent) {
            if (
                favoritesCoordinatorRef.current.hasActiveAddIntentsForDirectory(
                    hide.parentDirectory,
                )
            ) {
                scheduleFolderRefreshRef.current(hide.parentDirectory);
                syncFavoritesFolderPendingCreate(hide.parentDirectory);
                return;
            }
            void loadImplRef.current(hide.folderPath, false);
            return;
        }
        scheduleFolderRefreshRef.current(hide.parentDirectory);
    }

    function relistParentAfterFavoritesMassUnfavorite(
        sessionId: string,
        parentDirectory: string | null,
    ) {
        cancelPendingFolderExitAnimation();
        clearOptimisticFavoritesFolderHide(sessionId);
        if (parentDirectory) {
            scheduleFolderRefreshRef.current(parentDirectory);
            void fetchFavoriteOriginPaths(parentDirectory);
        }
    }

    function rollbackMassUnfavoriteCopyOrigin(copyPath: string) {
        const session = massUnfavoriteOriginRef.current;
        if (!session) {
            return;
        }
        const copyKey = pathKey(copyPath);
        const copyGeneration = session.copyGenerations.get(copyKey);
        if (copyGeneration !== undefined) {
            rollbackFavoriteStarOverlay(copyKey, copyGeneration);
            session.copyGenerations.delete(copyKey);
        }
        const originKey = session.copyToOrigin.get(copyKey);
        if (!originKey) {
            return;
        }
        const generation = session.originGenerations.get(originKey);
        if (generation !== undefined) {
            rollbackFavoriteStarOverlay(originKey, generation);
            session.originGenerations.delete(originKey);
        }
    }

    function restoreMassUnfavoriteCopyOriginOverlay(
        copyPath: string,
        sessionId: string,
    ) {
        const session = massUnfavoriteOriginRef.current;
        if (!session || session.sessionId !== sessionId) {
            return;
        }
        const originKey = session.copyToOrigin.get(pathKey(copyPath));
        if (!originKey || session.originGenerations.has(originKey)) {
            return;
        }
        if (
            shouldPreserveFavoritePathDuringMassUnfavorite(
                originKey,
                favoriteOverlayRef.current,
                favoritesCoordinatorRef.current.snapshotIntents(),
            )
        ) {
            return;
        }
        const generation = startFavoriteStarOverlay(
            originKey,
            false,
            sessionId,
        );
        session.originGenerations.set(originKey, generation);
    }

    function rollbackAllMassUnfavoriteOrigins(sessionId: string) {
        teardownMassUnfavoritePresentation(sessionId);
    }

    async function copyToFavoritesFromViewer(file: ImageFile) {
        const key = pathKey(file.path);
        const directory = viewRef.current.path;
        if (
            !directory ||
            viewRef.current.serviceRole ||
            inTrash ||
            busyPaths.has(key) ||
            fileOperationRef.current ||
            isFavoriteOverlayBlockingAdd(favoriteOverlayRef.current, key)
        ) {
            return;
        }
        if (tryQueueFavoriteAdds([file], directory)) {
            return;
        }
        syncFavoritesFolderPendingCreate(directory);
        bumpFavoriteAddQueueRevision();
        markBusy([key], true);
        const id = operationId();
        const overlayGeneration = startFavoriteStarOverlay(key, true, id);
        try {
            const result = await invoke<FileOperationResult>(
                'run_file_operation',
                {
                    operationId: id,
                    currentDirectory: directory,
                    action: 'copy_to_local_favorites',
                    paths: [file.path],
                },
            );
            if (
                !viewRef.current.path ||
                pathKey(viewRef.current.path) !== pathKey(result.directory)
            ) {
                rollbackFavoriteStarOverlay(key, overlayGeneration);
                return;
            }
            if (result.destinationFolder && result.destinationRole) {
                const destKey = pathKey(result.destinationFolder);
                const missing = !viewRef.current.folders.some(
                    (folder) => pathKey(folder.path) === destKey,
                );
                if (result.destinationCreated || missing) {
                    addServiceFolderToView(
                        result.destinationFolder,
                        result.destinationRole,
                    );
                }
            }
            const summary = summarize(result.outcomes);
            const markedFavorite =
                summary.copied > 0 || summary.alreadyExists > 0;
            if (markedFavorite) {
                noteFavoritePathsConfirmedLocalMutation();
                setFavoritePaths((current) => {
                    const next = new Set(current);
                    next.add(key);
                    return next;
                });
                rollbackFavoriteStarOverlay(key, overlayGeneration);
            } else if (summary.failed > 0) {
                rollbackFavoriteStarOverlay(key, overlayGeneration);
                setFileNotice(
                    operationNotice('copy_to_local_favorites', summary),
                );
            } else {
                rollbackFavoriteStarOverlay(key, overlayGeneration);
            }
        } catch (error: unknown) {
            rollbackFavoriteStarOverlay(key, overlayGeneration);
            setFileNotice({
                tone: 'failed',
                text: formatInvokeError(error),
                details: [],
            });
        } finally {
            markBusy([key], false);
            syncFavoritesFolderPendingCreate(directory);
            bumpFavoriteAddQueueRevision();
        }
    }

    function starOnFromQueuedAddOnly(key: string): boolean {
        if (inFavorites || favoritePaths.has(key)) {
            return false;
        }
        const intent = favoritesCoordinatorRef.current.getIntent(key);
        return intent?.status === 'queued' && intent.desired;
    }

    async function toggleFavoriteFile(file: ImageFile, confirmed = false) {
        const key = pathKey(file.path);
        const active = favoriteDisplayOn(
            key,
            favoritePaths,
            favoriteOverlayRef.current,
            inFavorites,
        );
        if (
            inTrash ||
            busyPaths.has(key) ||
            !viewRef.current.path ||
            fileOperationRef.current ||
            lockedUnfavoritePathsRef.current.has(key) ||
            (!active &&
                isFavoriteOverlayBlockingAdd(favoriteOverlayRef.current, key))
        ) {
            return;
        }
        if (!active) {
            if (viewerShowsFile(file)) {
                void copyToFavoritesFromViewer(file);
            } else {
                runFileAction('copy_to_local_favorites', [file]);
            }
            return;
        }
        if (
            isFavoriteAddIntentExecuting(
                favoritesCoordinatorRef.current.snapshotIntents(),
                key,
            )
        ) {
            return;
        }
        if (starOnFromQueuedAddOnly(key) && cancelQueuedFavoriteAdd(key)) {
            return;
        }
        if (confirmed) {
            const prompt = unfavoritePromptRef.current;
            if (
                !prompt ||
                prompt.mode !== 'single' ||
                pathKey(prompt.file.path) !== key
            ) {
                return;
            }
        } else if (backgroundUnfavoriteRef.current) {
            return;
        } else if (!canStartUnfavorite(unfavoriteGateRef.current)) {
            // T037: любой in-flight / confirmPending блокирует новый старт.
            return;
        }
        const queuedIntent = favoritesCoordinatorRef.current.getIntent(key);
        if (queuedIntent) {
            favoritesCoordinatorRef.current.upsertAddIntent({
                intentId: operationId(),
                photoKey: key,
                photoPath: file.path,
                albumDirectory: viewRef.current.path,
                overlayOperationId: queuedIntent.overlayOperationId,
                desired: false,
            });
        }
        const removeOpId = operationId();
        const overlayGeneration = startFavoriteStarOverlay(
            key,
            false,
            removeOpId,
        );
        setSelection((current) =>
            removePathsFromSelection(current, directoryKey, new Set([key])),
        );
        lockedUnfavoritePathsRef.current.add(key);
        markBusy([key], true);
        try {
            const removal = await invoke<RemoveFavoriteCopyResult>(
                'remove_favorite_copy',
                {
                    path: file.path,
                    confirmed,
                },
            );
            if (removal.status === 'needs_confirm') {
                rollbackFavoriteStarOverlay(key, overlayGeneration);
                if (confirmed) {
                    setFileNotice({
                        tone: 'failed',
                        text: 'Требуется подтверждение',
                        details: [],
                    });
                    return;
                }
                const kind = removal.confirmKind ?? 'unknown_origin';
                const uiRoute = mapRemovalToUiRoute({
                    status: removal.status,
                    confirmKind: kind,
                    fr11Required: removal.fr11Required,
                });
                if (uiRoute === 'fr11') {
                    const flightToken = operationId();
                    setUnfavoriteGate(
                        markUnfavoriteConfirmPending(
                            beginUnfavorite(flightToken),
                        ),
                    );
                    setFavoriteMissingOrigin({ file, flightToken });
                    return;
                }
                if (uiRoute === 'originInTrash') {
                    setFavoriteTrashUnfavorite(file);
                    return;
                }
                setUnfavoritePrompt({ mode: 'single', file, kind });
                return;
            }
            applyUnfavoriteResult(file, removal);
            rollbackFavoriteStarOverlay(key, overlayGeneration);
        } catch (error: unknown) {
            rollbackFavoriteStarOverlay(key, overlayGeneration);
            setFileNotice({
                tone: 'failed',
                text: formatInvokeError(error),
                details: [],
            });
        } finally {
            lockedUnfavoritePathsRef.current.delete(key);
            markBusy([key], false);
        }
    }

    async function removeSelectedFromFavorites(files: ImageFile[]) {
        const directory = viewRef.current.path;
        const role = viewRef.current.serviceRole;
        if (!directory || role !== 'favorites' || fileOperationRef.current) {
            return;
        }
        if (
            !canStartUnfavorite(unfavoriteGateRef.current) ||
            backgroundUnfavoriteRef.current ||
            pathsConflictWithUnfavoriteLock(files)
        ) {
            return;
        }
        const sessionId = operationId();
        const sessionPath = directory;
        const parentDirectory = resolveUnfavoriteParentDirectory(
            viewRef.current.parent,
            sessionPath,
        );
        const targets = prepareFavoriteRemovalTargets(files, sessionPath);
        if (targets.length === 0) {
            return;
        }
        setUnfavoriteGate(beginUnfavorite(sessionId));
        favoritesCoordinatorRef.current.beginMassUnfavorite({
            operationId: sessionId,
            parentDirectory,
            sessionPath,
        });
        beginMassUnfavoriteOriginSession(sessionId, sessionPath);
        const listingReady =
            status === 'ready' && !folderListingBusyRef.current;
        const optimisticFullFavoritesClear =
            parentDirectory &&
            shouldOptimisticallyHideFavoritesServiceFolder({
                sessionPath,
                targets,
                listingImages: viewRef.current.images,
                childFolderCount: viewRef.current.folders.length,
                listingReady,
            });
        logMassUnfavoriteDiag({
            stage: 'start',
            operationId: sessionId,
            optimisticFullFavoritesClear: Boolean(optimisticFullFavoritesClear),
            targetCount: targets.length,
            listingImageCount: viewRef.current.images.length,
            childFolderCount: viewRef.current.folders.length,
            hasParentDirectory: Boolean(parentDirectory),
        });
        if (optimisticFullFavoritesClear) {
            setMassUnfavoriteExitingFavorites(true);
            flushSync(() => {
                beginOptimisticFavoritesFolderHide(
                    sessionId,
                    sessionPath,
                    parentDirectory,
                );
                applyRemovedServiceFolder({
                    folderPath: sessionPath,
                    parentDirectory,
                });
            });
        }
        applyInstantMassUnfavoritePresentation(sessionId, targets);
        const landingKey = massUnfavoriteStartLandingKey({
            currentPath: sessionPath,
            sessionPath,
            parentDirectory,
        });
        {
            const cleared = selectionAfterMassUnfavorite(landingKey);
            setSelectionMode(cleared.selectionMode);
            setSelection(cleared.selection);
        }

        void (async () => {
            let buckets;
            let previews: FavoriteBatchPathResult[] = [];
            try {
                previews = await invoke<FavoriteBatchPathResult[]>(
                    'preview_remove_favorite_copies',
                    { paths: targets.map((file) => file.path) },
                );
                logUnfavoriteBatchClassifyDebug(previews);
                buckets = bucketUnfavoriteUiTargets(targets, previews);
                for (const file of [
                    ...buckets.fr11Required,
                    ...buckets.standardConfirm,
                    ...buckets.originInTrash,
                ]) {
                    rollbackMassUnfavoriteCopyOrigin(file.path);
                }
            } catch (error: unknown) {
                rollbackAllMassUnfavoriteOrigins(sessionId);
                clearOptimisticFavoritesFolderHide(sessionId);
                releaseUnfavoriteGate();
                setFileNotice({
                    tone: 'failed',
                    text: formatInvokeError(error),
                    details: [],
                });
                return;
            }

            const pendingBase = {
                sessionId,
                sessionPath,
                parentDirectory,
                readyFiles: buckets.ready,
                trashFiles: buckets.originInTrash,
                fr11Files: buckets.fr11Required,
                confirmFiles: buckets.standardConfirm,
                priorResults: buckets.previewFailed,
                fr11Resolved: [] as {
                    file: ImageFile;
                    resolution:
                        | 'return_to_source'
                        | 'keep_copy'
                        | 'recycle_copy'
                        | `choose_folder:${string}`;
                }[],
            };

            if (buckets.originInTrash.length > 0) {
                clearOptimisticFavoritesFolderHide(sessionId);
                unfavoriteBatchRef.current = pendingBase;
                setMassTrashBatchCounts(
                    computeMassTrashBatchCounts(targets.length, {
                        ready: buckets.ready,
                        originInTrash: buckets.originInTrash,
                        otherConfirm: [
                            ...buckets.fr11Required,
                            ...buckets.standardConfirm,
                        ],
                        fr11Required: buckets.fr11Required,
                        standardConfirm: buckets.standardConfirm,
                    }),
                );
                setMassTrashUnfavoriteOpen(true);
                setUnfavoriteGate({
                    busy: true,
                    sessionId,
                    confirmPending: true,
                    flightToken: sessionId,
                });
                return;
            }

            if (buckets.fr11Required.length > 0) {
                clearOptimisticFavoritesFolderHide(sessionId);
                unfavoriteBatchRef.current = pendingBase;
                openNextMassFr11Dialog(sessionId);
                return;
            }

            if (buckets.standardConfirm.length > 0) {
                clearOptimisticFavoritesFolderHide(sessionId);
                unfavoriteBatchRef.current = pendingBase;
                openMassStandardConfirmDialog(previews);
                return;
            }

            void startBackgroundMassUnfavorite({
                sessionId,
                sessionPath,
                parentDirectory,
                work: buckets.ready.map((file) => ({ file, confirmed: false })),
                priorResults: buckets.previewFailed,
            });
        })();
    }

    /** T043: следующий FR-11 файл из очереди mass unfavorite. */
    function openNextMassFr11Dialog(sessionId: string) {
        const pending = unfavoriteBatchRef.current;
        if (!pending || pending.sessionId !== sessionId) {
            return;
        }
        const next = pending.fr11Files[0];
        if (!next) {
            continueMassUnfavoriteAfterConfirms();
            return;
        }
        setUnfavoriteGate(
            markUnfavoriteConfirmPending({
                busy: true,
                sessionId,
                confirmPending: false,
                flightToken: sessionId,
            }),
        );
        setFavoriteMissingOrigin({ file: next, flightToken: sessionId });
    }

    function openMassStandardConfirmDialog(
        previews: readonly FavoriteBatchPathResult[],
    ) {
        const pending = unfavoriteBatchRef.current;
        if (!pending || pending.confirmFiles.length === 0) {
            continueMassUnfavoriteAfterConfirms();
            return;
        }
        const confirmLines: BatchUnfavoriteConfirmLine[] =
            batchUnfavoriteConfirmLines(pending.confirmFiles, previews);
        setUnfavoriteGate(
            markUnfavoriteConfirmPending(unfavoriteGateRef.current),
        );
        setUnfavoritePrompt({
            mode: 'batch',
            files: pending.confirmFiles,
            confirmLines,
            sessionPath: pending.sessionPath,
            parentDirectory: pending.parentDirectory,
        });
    }

    /** После trash/FR-11: standard confirm или единый background pass. */
    function continueMassUnfavoriteAfterConfirms() {
        const pending = unfavoriteBatchRef.current;
        if (!pending) {
            releaseUnfavoriteGate();
            return;
        }
        if (pending.fr11Files.length > 0) {
            openNextMassFr11Dialog(pending.sessionId);
            return;
        }
        if (pending.confirmFiles.length > 0) {
            void invoke<FavoriteBatchPathResult[]>(
                'preview_remove_favorite_copies',
                { paths: pending.confirmFiles.map((file) => file.path) },
            )
                .then((previews) => {
                    if (
                        unfavoriteBatchRef.current?.sessionId !==
                        pending.sessionId
                    ) {
                        return;
                    }
                    openMassStandardConfirmDialog(previews);
                })
                .catch(() => {
                    if (
                        unfavoriteBatchRef.current?.sessionId !==
                        pending.sessionId
                    ) {
                        return;
                    }
                    openMassStandardConfirmDialog([]);
                });
            return;
        }
        flushMassUnfavoriteBatchWork();
    }

    /** Собирает ready/trash/FR-11/standard в один remove_favorite_copies_batch. */
    function flushMassUnfavoriteBatchWork(
        standardConfirmed: readonly ImageFile[] = [],
    ) {
        const pending = unfavoriteBatchRef.current;
        if (!pending) {
            releaseUnfavoriteGate();
            return;
        }
        const work: {
            file: ImageFile;
            confirmed: boolean;
            resolution?: string;
        }[] = [];
        const priorResults: UnfavoriteBatchItemResult[] = [
            ...pending.priorResults,
        ];

        const trashResolution = pending.trashResolution;
        if (trashResolution === 'recycle_copy') {
            work.push(
                ...pending.readyFiles.map((file) => ({
                    file,
                    confirmed: false,
                })),
                ...pending.trashFiles.map((file) => ({
                    file,
                    confirmed: true,
                    resolution: 'recycle_copy',
                })),
            );
        } else if (trashResolution === 'restore_origin') {
            for (const file of pending.readyFiles) {
                rollbackMassUnfavoriteCopyOrigin(file.path);
            }
            work.push(
                ...pending.trashFiles.map((file) => ({
                    file,
                    confirmed: true,
                    resolution: 'restore_origin',
                })),
            );
        } else {
            work.push(
                ...pending.readyFiles.map((file) => ({
                    file,
                    confirmed: false,
                })),
            );
        }

        for (const item of pending.fr11Resolved) {
            if (item.resolution === 'keep_copy') {
                priorResults.push({
                    path: item.file.path,
                    status: 'skipped',
                    reason: 'keep_copy',
                });
                continue;
            }
            work.push({
                file: item.file,
                confirmed: true,
                resolution: item.resolution,
            });
        }

        work.push(
            ...standardConfirmed.map((file) => ({
                file,
                confirmed: true,
            })),
        );

        const sessionId = pending.sessionId;
        const sessionPath = pending.sessionPath;
        const parentDirectory = pending.parentDirectory;
        unfavoriteBatchRef.current = null;
        void startBackgroundMassUnfavorite({
            sessionId,
            sessionPath,
            parentDirectory,
            work,
            priorResults,
        });
    }

    function cancelMassTrashUnfavorite() {
        const pending = unfavoriteBatchRef.current;
        setMassTrashUnfavoriteOpen(false);
        setMassTrashBatchCounts(null);
        if (!pending) {
            releaseUnfavoriteGate();
            return;
        }
        for (const file of pending.trashFiles) {
            rollbackMassUnfavoriteCopyOrigin(file.path);
        }
        unfavoriteBatchRef.current = null;
        releaseUnfavoriteGate();
    }

    function confirmMassTrashUnfavorite(
        resolution: 'recycle_copy' | 'restore_origin',
    ) {
        const pending = unfavoriteBatchRef.current;
        setMassTrashUnfavoriteOpen(false);
        setMassTrashBatchCounts(null);
        if (!pending) {
            return;
        }
        const gate = unfavoriteGateRef.current;
        let nextGate = beginUnfavoriteConfirmPass(gate, pending.sessionId);
        if (
            !nextGate &&
            gate.busy &&
            gate.sessionId === pending.sessionId
        ) {
            nextGate = {
                busy: true,
                sessionId: pending.sessionId,
                confirmPending: false,
                flightToken: pending.sessionId,
            };
        }
        if (!nextGate) {
            setFileNotice({
                tone: 'failed',
                text: 'Не удалось продолжить снятие избранного. Повторите операцию.',
                details: [],
            });
            releaseUnfavoriteGate();
            return;
        }
        setUnfavoriteGate(nextGate);
        unfavoriteBatchRef.current = {
            ...pending,
            trashResolution: resolution,
        };
        continueMassUnfavoriteAfterConfirms();
    }

    async function confirmBatchUnfavorite(files: ImageFile[]) {
        const pending = unfavoriteBatchRef.current;
        if (!pending) {
            return;
        }
        const nextGate = beginUnfavoriteConfirmPass(
            unfavoriteGateRef.current,
            pending.sessionId,
        );
        if (!nextGate) {
            return;
        }
        setUnfavoriteGate(nextGate);
        for (const file of files) {
            restoreMassUnfavoriteCopyOriginOverlay(file.path, pending.sessionId);
        }
        unfavoriteBatchRef.current = {
            ...pending,
            confirmFiles: [],
        };
        flushMassUnfavoriteBatchWork(files);
    }

    function skipBatchUnfavorite(files: ImageFile[]) {
        const pending = unfavoriteBatchRef.current;
        if (!pending) {
            setUnfavoritePrompt(null);
            releaseUnfavoriteGate();
            return;
        }
        if (
            !beginUnfavoriteConfirmPass(
                unfavoriteGateRef.current,
                pending.sessionId,
            )
        ) {
            return;
        }
        const skipped: UnfavoriteBatchItemResult[] = files.map((file) => ({
            path: file.path,
            status: 'skipped',
        }));
        setUnfavoritePrompt(null);
        for (const file of files) {
            rollbackMassUnfavoriteCopyOrigin(file.path);
        }
        unfavoriteBatchRef.current = {
            ...pending,
            confirmFiles: [],
            priorResults: [...pending.priorResults, ...skipped],
        };
        flushMassUnfavoriteBatchWork();
    }
    skipBatchUnfavoriteRef.current = skipBatchUnfavorite;

    async function startBackgroundMassUnfavorite(options: {
        sessionId: string;
        sessionPath: string;
        parentDirectory: string | null;
        work: {
            file: ImageFile;
            confirmed: boolean;
            /** recycle/restore/FR-11 resolution (в т.ч. choose_folder:…). */
            resolution?: string;
        }[];
        priorResults: UnfavoriteBatchItemResult[];
    }) {
        if (backgroundUnfavoriteRef.current) {
            releaseUnfavoriteGate();
            return;
        }
        const workFiles = options.work.map((item) => item.file);
        if (workFiles.length === 0 && options.priorResults.length > 0) {
            await finishBackgroundMassUnfavorite({
                sessionId: options.sessionId,
                sessionPath: options.sessionPath,
                parentDirectory: options.parentDirectory,
                results: options.priorResults,
            });
            const notice = summarizeUnfavoriteBatch({
                total: options.priorResults.length,
                succeeded: 0,
                failed: options.priorResults.filter(
                    (item) => item.status === 'failed',
                ).length,
                skipped: options.priorResults.filter(
                    (item) => item.status === 'skipped',
                ).length,
                cleanup: {
                    status: null,
                    navigateLocation: null,
                    appRemovedFolder: false,
                },
                errors: options.priorResults
                    .filter((item) => item.status === 'failed')
                    .map((item) =>
                        item.status === 'failed' ? item.message : '',
                    ),
            });
            if (notice.tone !== 'ok') {
                setFileNotice(notice);
            }
            releaseUnfavoriteGate();
            return;
        }
        if (workFiles.length === 0) {
            releaseUnfavoriteGate();
            return;
        }

        backgroundUnfavoriteRef.current = true;
        setUnfavoriteBusy(true);
        lockUnfavoritePaths(workFiles);

        try {
            const results: UnfavoriteBatchItemResult[] = [
                ...options.priorResults,
            ];
            try {
                const batch = await invoke<FavoriteBatchPathResult[]>(
                    'remove_favorite_copies_batch',
                    {
                        items: options.work.map((item) => ({
                            path: item.file.path,
                            confirmed: item.confirmed,
                            resolution: item.resolution ?? null,
                        })),
                    },
                );
                for (const entry of batch) {
                    const interpreted = interpretRemovalOutcome(
                        entry.path,
                        entry.result,
                    );
                    if (interpreted.status === 'needs_confirm') {
                        results.push({
                            path: entry.path,
                            status: 'failed',
                            message: 'Требуется подтверждение',
                        });
                    } else {
                        results.push(interpreted);
                        if (
                            (interpreted.status === 'recycled' ||
                                interpreted.status === 'relocated') &&
                            entry.result.undoId
                        ) {
                            void invoke('discard_favorite_undo', {
                                id: entry.result.undoId,
                            });
                        }
                    }
                }
            } catch (error: unknown) {
                // T044b / FR-008: не помечать все failed без disk-truth (preview).
                const message = formatInvokeError(error);
                let postPreviews: FavoriteBatchPathResult[] | null = null;
                try {
                    postPreviews = await invoke<FavoriteBatchPathResult[]>(
                        'preview_remove_favorite_copies',
                        {
                            paths: options.work.map((item) => item.file.path),
                        },
                    );
                } catch {
                    postPreviews = null;
                }
                const classified =
                    classifyMassUnfavoriteWorkAfterTransportFailure(
                        options.work.map((item) => item.file.path),
                        postPreviews,
                    );
                // Без preview — needs_reconciliation; не «все failed» (FR-008).
                if (!mayAnnounceAllBatchFailed(postPreviews !== null)) {
                    for (const row of classified) {
                        results.push({
                            path: row.path,
                            status: 'failed',
                            message: 'needs_reconciliation',
                        });
                    }
                } else {
                    for (const row of classified) {
                        if (row.verdict === 'still_present') {
                            results.push({
                                path: row.path,
                                status: 'failed',
                                message,
                            });
                        } else if (row.verdict === 'absent') {
                            results.push({
                                path: row.path,
                                status: 'recycled',
                                result: {
                                    status: 'recycled',
                                    undoId: '',
                                } as RemoveFavoriteCopyResult,
                            });
                        } else {
                            results.push({
                                path: row.path,
                                status: 'failed',
                                message: 'needs_reconciliation',
                            });
                        }
                    }
                }
            }
            await finishBackgroundMassUnfavorite({
                sessionId: options.sessionId,
                sessionPath: options.sessionPath,
                parentDirectory: options.parentDirectory,
                results,
            });
        } finally {
            unlockUnfavoritePaths(workFiles);
            backgroundUnfavoriteRef.current = false;
            releaseUnfavoriteGate();
        }
    }

    async function finishBackgroundMassUnfavorite(options: {
        sessionId: string;
        sessionPath: string;
        parentDirectory: string | null;
        results: UnfavoriteBatchItemResult[];
    }) {
        favoritesCoordinatorRef.current.setMassUnfavoritePhase(
            options.sessionId,
            'finalizing',
        );
        const succeeded = options.results.filter(
            (item) => item.status === 'recycled' || item.status === 'relocated',
        );
        const failed = options.results.filter(
            (item) => item.status === 'failed',
        );
        const skipped = options.results.filter(
            (item) =>
                item.status === 'skipped' || item.status === 'needs_confirm',
        );
        const restored = options.results.filter(
            (item) => item.status === 'restored_origin',
        );
        const session = massUnfavoriteOriginRef.current;
        let favoritePathsConfirmedMutation = false;
        if (session && session.sessionId === options.sessionId) {
            for (const item of options.results) {
                if (
                    item.status === 'recycled' ||
                    item.status === 'relocated'
                ) {
                    const originKey = session.copyToOrigin.get(
                        pathKey(item.path),
                    );
                    if (originKey) {
                        const preserve =
                            shouldPreserveFavoritePathDuringMassUnfavorite(
                                originKey,
                                favoriteOverlayRef.current,
                                favoritesCoordinatorRef.current.snapshotIntents(),
                            );
                        if (!preserve) {
                            favoritePathsConfirmedMutation = true;
                            setFavoritePaths((current) => {
                                const next = new Set(current);
                                next.delete(originKey);
                                return next;
                            });
                        }
                    }
                    const generation = originKey
                        ? session.originGenerations.get(originKey)
                        : undefined;
                    if (
                        originKey &&
                        generation !== undefined &&
                        !shouldPreserveFavoritePathDuringMassUnfavorite(
                            originKey,
                            favoriteOverlayRef.current,
                            favoritesCoordinatorRef.current.snapshotIntents(),
                        )
                    ) {
                        rollbackFavoriteStarOverlay(originKey, generation);
                        session.originGenerations.delete(originKey);
                    }
                    const copyKey = pathKey(item.path);
                    const copyGeneration =
                        session.copyGenerations.get(copyKey);
                    if (copyGeneration !== undefined) {
                        rollbackFavoriteStarOverlay(copyKey, copyGeneration);
                        session.copyGenerations.delete(copyKey);
                    }
                } else if (item.status === 'restored_origin') {
                    favoritePathsConfirmedMutation = true;
                    const restored = item.result.restoredPath;
                    if (restored) {
                        const originKey = pathKey(restored);
                        setFavoritePaths((current) => {
                            const next = new Set(current);
                            next.add(originKey);
                            return next;
                        });
                    }
                    const copyKey = pathKey(item.path);
                    const copyGeneration =
                        session.copyGenerations.get(copyKey);
                    if (copyGeneration !== undefined) {
                        rollbackFavoriteStarOverlay(copyKey, copyGeneration);
                        session.copyGenerations.delete(copyKey);
                    }
                } else if (
                    item.status === 'skipped' ||
                    item.status === 'failed'
                ) {
                    rollbackMassUnfavoriteCopyOrigin(item.path);
                }
            }
        }
        if (favoritePathsConfirmedMutation) {
            noteFavoritePathsConfirmedLocalMutation();
        }
        // P1: batch FS уже завершён; снимаем coordinator busy и drain до cleanup/relist/refresh.
        await coordinatorFinishFilesystemSession(options.sessionId);
        let cleanup: UnfavoriteCleanupOutcome = pickCleanupFromResults(
            options.results,
        );

        if (
            !cleanup.navigateLocation &&
            cleanup.status !== 'not_empty' &&
            cleanup.status !== 'failed' &&
            succeeded.length > 0 &&
            options.parentDirectory &&
            !favoritesCoordinatorRef.current.hasActiveAddIntentsForDirectory(
                options.parentDirectory,
            )
        ) {
            const fallback = await cleanupEmptyServiceFolder(
                options.parentDirectory,
                options.sessionPath,
            );
            cleanup = mergeCleanupOutcomes(cleanup, fallback);
        }

        if (cleanup.navigateLocation) {
            const skipNav = shouldSkipPostBatchServiceFolderNavigation({
                navigateLocation: cleanup.navigateLocation,
                currentPath: viewRef.current.path,
                batchSessionId: options.sessionId,
                optimisticParentNav:
                    massUnfavoriteOptimisticParentNavRef.current,
            });
            if (skipNav) {
                logMassUnfavoriteDiag({
                    stage: 'finish_skip_nav',
                    operationId: options.sessionId,
                    reason: 'already_on_parent',
                });
            } else {
                logMassUnfavoriteDiag({
                    stage: 'finish_apply_nav',
                    operationId: options.sessionId,
                });
                applyRemovedServiceFolder(cleanup.navigateLocation);
            }
        }

        const folderActuallyRemoved =
            cleanup.navigateLocation != null ||
            cleanup.status === 'removed' ||
            cleanup.status === 'already_gone';
        const restoreKeptFavoriteCopies = restored.length > 0;
        if (restoreKeptFavoriteCopies || !folderActuallyRemoved) {
            relistParentAfterFavoritesMassUnfavorite(
                options.sessionId,
                options.parentDirectory,
            );
        } else if (
            optimisticFavoritesFolderHideRef.current?.operationId ===
            options.sessionId
        ) {
            if (
                cleanup.status === 'not_empty' ||
                cleanup.status === 'failed' ||
                failed.length > 0
            ) {
                clearOptimisticFavoritesFolderHide(options.sessionId);
            } else {
                optimisticFavoritesFolderHideRef.current = null;
                setOptimisticHiddenFolderKeys(new Set());
                massUnfavoriteOptimisticParentNavRef.current = null;
            }
        }

        const currentPath = viewRef.current.path;
        if (
            shouldApplyMassUnfavoriteSelectionReset({
                currentPath,
                sessionPath: options.sessionPath,
            })
        ) {
            const landingKey = massUnfavoriteFinishLandingKey({
                currentPath,
                sessionPath: options.sessionPath,
                parentDirectory: options.parentDirectory,
                navigateLocation: cleanup.navigateLocation,
            });
            const cleared = selectionAfterMassUnfavorite(landingKey);
            setSelectionMode(cleared.selectionMode);
            setSelection(cleared.selection);
        }

        if (
            currentPath &&
            viewRef.current.serviceRole !== 'favorites' &&
            pathKey(currentPath) !== pathKey(options.sessionPath)
        ) {
            scheduleFolderRefreshRef.current(currentPath);
            void fetchFavoriteOriginPaths(currentPath);
        } else if (options.parentDirectory && !cleanup.navigateLocation) {
            scheduleFolderRefreshRef.current(options.parentDirectory);
        }

        const needsReconciliation = options.results.filter(
            (item) =>
                item.status === 'failed' &&
                item.message === 'needs_reconciliation',
        ).length;
        const notice =
            restored.length > 0 || needsReconciliation > 0
                ? summarizeUnfavoriteBatchDetailed({
                      processed: options.results.length,
                      succeeded: succeeded.length,
                      skipped: skipped.length,
                      failed: failed.length,
                      restored: restored.length,
                      needsReconciliation,
                  })
                : summarizeUnfavoriteBatch({
                      total: options.results.length,
                      succeeded: succeeded.length,
                      failed: failed.length,
                      skipped: skipped.length,
                      cleanup,
                      errors: failed.map((item) =>
                          item.status === 'failed' ? item.message : '',
                      ),
                  });
        if (needsReconciliation > 0) {
            setFileNotice(
                succeeded.length > 0 || restored.length > 0
                    ? favoritesPartialSuccessNotice()
                    : favoritesNeedsReviewNotice(),
            );
        } else if (notice.tone !== 'ok') {
            setFileNotice(notice);
        }
        syncFavoritesFolderPendingCreate(options.parentDirectory);
        bumpFavoriteAddQueueRevision();
    }

    async function resolveTrashUnfavorite(
        file: ImageFile,
        resolution: 'recycle_copy' | 'restore_origin',
    ) {
        setFavoriteTrashUnfavorite(null);
        const key = pathKey(file.path);
        const overlayGeneration = startFavoriteStarOverlay(key, false, operationId());
        lockedUnfavoritePathsRef.current.add(key);
        markBusy([key], true);
        try {
            const removal = await invoke<RemoveFavoriteCopyResult>(
                'remove_favorite_copy',
                {
                    path: file.path,
                    confirmed: true,
                    resolution,
                },
            );
            applyUnfavoriteResult(file, removal);
            rollbackFavoriteStarOverlay(key, overlayGeneration);
        } catch (error: unknown) {
            rollbackFavoriteStarOverlay(key, overlayGeneration);
            setFileNotice({
                tone: 'failed',
                text: formatInvokeError(error),
                details: [],
            });
        } finally {
            lockedUnfavoritePathsRef.current.delete(key);
            markBusy([key], false);
        }
    }

    function cancelMissingOriginUnfavorite() {
        const pending = favoriteMissingOrigin;
        setFavoriteMissingOrigin(null);
        const batch = unfavoriteBatchRef.current;
        // T043: cancel одного FR-11 в mass = keep_copy для этого файла, очередь продолжается.
        if (
            pending &&
            batch &&
            batch.sessionId === pending.flightToken &&
            batch.fr11Files.some(
                (file) => pathKey(file.path) === pathKey(pending.file.path),
            )
        ) {
            if (
                !canResolveUnfavoriteConfirm(
                    unfavoriteGateRef.current,
                    pending.flightToken,
                )
            ) {
                return;
            }
            beginUnfavoriteConfirmPass(
                unfavoriteGateRef.current,
                pending.flightToken,
            );
            unfavoriteBatchRef.current = {
                ...batch,
                fr11Files: batch.fr11Files.filter(
                    (file) => pathKey(file.path) !== pathKey(pending.file.path),
                ),
                fr11Resolved: [
                    ...batch.fr11Resolved,
                    { file: pending.file, resolution: 'keep_copy' },
                ],
            };
            continueMassUnfavoriteAfterConfirms();
            return;
        }
        if (
            pending &&
            canResolveUnfavoriteConfirm(
                unfavoriteGateRef.current,
                pending.flightToken,
            )
        ) {
            setUnfavoriteGate(endUnfavorite());
        } else if (
            pending &&
            unfavoriteGateRef.current.sessionId === pending.flightToken
        ) {
            setUnfavoriteGate(endUnfavorite());
        }
    }

    /**
     * FR-11 A/B/C/D → remove_favorite_copy resolution.
     * B: `choose_folder:<path>` (BE P4b stub may still reject — UI presents picker).
     * Mass (T043): копит resolution и показывает следующий FR-11 / flush.
     */
    async function resolveMissingOriginUnfavorite(
        resolution:
            | 'return_to_source'
            | 'keep_copy'
            | 'recycle_copy'
            | `choose_folder:${string}`,
    ) {
        const pending = favoriteMissingOrigin;
        if (!pending) {
            return;
        }
        const pass = beginUnfavoriteConfirmPass(
            unfavoriteGateRef.current,
            pending.flightToken,
        );
        if (!pass) {
            return;
        }
        setUnfavoriteGate(pass);
        setFavoriteMissingOrigin(null);

        const batch = unfavoriteBatchRef.current;
        if (
            batch &&
            batch.sessionId === pending.flightToken &&
            batch.fr11Files.some(
                (file) => pathKey(file.path) === pathKey(pending.file.path),
            )
        ) {
            unfavoriteBatchRef.current = {
                ...batch,
                fr11Files: batch.fr11Files.filter(
                    (file) => pathKey(file.path) !== pathKey(pending.file.path),
                ),
                fr11Resolved: [
                    ...batch.fr11Resolved,
                    { file: pending.file, resolution },
                ],
            };
            continueMassUnfavoriteAfterConfirms();
            return;
        }

        if (resolution === 'keep_copy') {
            try {
                await invoke<RemoveFavoriteCopyResult>('remove_favorite_copy', {
                    path: pending.file.path,
                    confirmed: true,
                    resolution: 'keep_copy',
                });
            } catch {
                // Копия уже на месте после needs_confirm — локальный cancel достаточен.
            } finally {
                setUnfavoriteGate(endUnfavorite());
            }
            return;
        }

        const file = pending.file;
        const key = pathKey(file.path);
        const overlayGeneration = startFavoriteStarOverlay(
            key,
            false,
            operationId(),
        );
        lockedUnfavoritePathsRef.current.add(key);
        markBusy([key], true);
        try {
            const removal = await invoke<RemoveFavoriteCopyResult>(
                'remove_favorite_copy',
                {
                    path: file.path,
                    confirmed: true,
                    resolution,
                },
            );
            applyUnfavoriteResult(file, removal);
            rollbackFavoriteStarOverlay(key, overlayGeneration);
        } catch (error: unknown) {
            rollbackFavoriteStarOverlay(key, overlayGeneration);
            setFileNotice({
                tone: 'failed',
                text: formatInvokeError(error),
                details: [],
            });
        } finally {
            lockedUnfavoritePathsRef.current.delete(key);
            markBusy([key], false);
            setUnfavoriteGate(endUnfavorite());
        }
    }

    async function resolveMissingOriginChooseFolder() {
        const pending = favoriteMissingOrigin;
        if (
            !pending ||
            !canResolveUnfavoriteConfirm(
                unfavoriteGateRef.current,
                pending.flightToken,
            )
        ) {
            return;
        }
        const directory = await selectFolder();
        if (!directory) {
            // Пикер отменён — диалог остаётся открытым (токен жив).
            return;
        }
        await resolveMissingOriginUnfavorite(`choose_folder:${directory}`);
    }

    function applyUnfavoriteResult(
        file: ImageFile,
        removal: RemoveFavoriteCopyResult,
    ) {
        if (removal.status === 'restored_origin') {
            noteFavoritePathsConfirmedLocalMutation();
            if (removal.restoredPath) {
                const originKey = pathKey(removal.restoredPath);
                setFavoritePaths((current) => {
                    const next = new Set(current);
                    next.add(originKey);
                    return next;
                });
                const normalized = removal.restoredPath
                    .replace(/\//g, '\\')
                    .replace(/\\+$/, '');
                const sep = normalized.lastIndexOf('\\');
                if (sep > 0) {
                    void fetchFavoriteOriginPaths(normalized.slice(0, sep));
                }
            }
            if (viewRef.current.path && viewRef.current.serviceRole !== 'favorites') {
                scheduleFolderRefreshRef.current(viewRef.current.path);
            }
            const parent = viewRef.current.parent;
            if (parent) {
                scheduleFolderRefreshRef.current(parent);
            }
            return;
        }
        // CL-P05: do not clear stars/listing on indeterminate / failed reconcile.
        if (
            favoriteNeedsReviewNotice({
                reconcileSuggested: removal.reconcileSuggested,
            }) ||
            removal.status === 'failed'
        ) {
            const key = pathKey(file.path);
            setFavoriteOverlay((current) =>
                rollbackIndeterminateFavoriteOverlay(current, [key]),
            );
            if (
                favoriteNeedsReviewNotice({
                    reconcileSuggested: removal.reconcileSuggested,
                })
            ) {
                setFileNotice(favoritesNeedsReviewNotice());
            } else {
                setFileNotice({
                    tone: 'failed',
                    text: removal.noticeCode
                        ? formatInvokeError(removal.noticeCode)
                        : t('selection.unfavoriteUnexpectedResponse'),
                    details: [],
                });
            }
            return;
        }
        const key = pathKey(file.path);
        setFavoriteOverlay((current) => clearFavoriteOverlayKey(current, key));
        const cleanup = cleanupOutcomeFromStatus(
            removal.cleanupStatus,
            removal.removedServiceFolder ?? null,
        );
        if (cleanup.navigateLocation) {
            applyRemovedServiceFolder(cleanup.navigateLocation);
        }
        if (inFavorites && !cleanup.navigateLocation) {
            const removed = new Set([key]);
            setView((current) => ({
                ...current,
                images: current.images.filter(
                    (item) => pathKey(item.path) !== key,
                ),
            }));
            if (viewerIndexRef.current !== null) {
                setViewerIndex(
                    viewerIndexAfterRemoval(
                        orderedRef.current.map((item) => pathKey(item.path)),
                        viewerIndexRef.current,
                        removed,
                    ),
                );
            }
        } else if (!inFavorites) {
            noteFavoritePathsConfirmedLocalMutation();
            setFavoritePaths((current) => {
                const next = new Set(current);
                next.delete(key);
                return next;
            });
        }
        if (cleanup.status === 'failed') {
            setFileNotice({
                tone: 'partial',
                text: t('selection.unfavoriteCleanupFailed'),
                details: [],
            });
        } else if (removal.status === 'relocated') {
            if (
                viewRef.current.path &&
                viewRef.current.serviceRole !== 'favorites'
            ) {
                scheduleFolderRefreshRef.current(viewRef.current.path);
            }
        }
        if (removal.undoId) {
            void invoke('discard_favorite_undo', { id: removal.undoId });
        }
    }

    function unfavoritePromptCopy(kind: RemoveFavoriteConfirmKind): {
        text: string;
        confirmLabel: string;
    } {
        if (kind === 'unknown_origin') {
            return {
                text: `${t('selection.favoriteUnknownTitle')}\n\n${t('selection.favoriteUnknownBody')}`,
                confirmLabel: t('selection.favoriteMoveLabel'),
            };
        }
        return {
            text: `${t('selection.favoriteChangedTitle')}\n\n${t('selection.favoriteChangedBody')}`,
            confirmLabel: t('selection.favoriteSaveCopyLabel'),
        };
    }

    async function recycleTrashFile(file: ImageFile) {
        const key = pathKey(file.path);
        if (busyPaths.has(key)) {
            return;
        }
        markBusy([key], true);
        try {
            const result = await recycleLocalTrashFile(file.path);
            applyRemovedServiceFolder(result.removedServiceFolder);
            const removed = new Set([key]);
            setView((current) => ({
                ...current,
                images: current.images.filter(
                    (item) => pathKey(item.path) !== key,
                ),
            }));
            if (viewerIndexRef.current !== null) {
                setViewerIndex(
                    viewerIndexAfterRemoval(
                        orderedRef.current.map((item) => pathKey(item.path)),
                        viewerIndexRef.current,
                        removed,
                    ),
                );
            }
            setFileNotice({
                tone: 'ok',
                text: t('trash.recycledToWindows'),
                details: [],
            });
        } catch (error: unknown) {
            setFileNotice({
                tone: 'failed',
                text: formatInvokeError(error),
                details: [],
            });
        } finally {
            markBusy([key], false);
        }
    }

    async function restoreFile(
        file: ImageFile,
        mode: 'renamed' | 'chosen' | 'parent' = 'parent',
        chosenDirectory?: string,
    ) {
        const key = pathKey(file.path);
        if (busyPaths.has(key)) {
            return;
        }
        markBusy([key], true);
        try {
            const restoredResult = await invoke<RestoreTrashResult>(
                'restore_local_trash',
                {
                    path: file.path,
                    mode,
                    chosenDirectory: chosenDirectory ?? null,
                },
            );
            applyRemovedServiceFolder(restoredResult.removedServiceFolder);
            const removed = new Set([key]);
            setView((current) => ({
                ...current,
                images: current.images.filter(
                    (item) => pathKey(item.path) !== key,
                ),
            }));
            if (viewerIndexRef.current !== null) {
                setViewerIndex(
                    viewerIndexAfterRemoval(
                        orderedRef.current.map((item) => pathKey(item.path)),
                        viewerIndexRef.current,
                        removed,
                    ),
                );
            }
            setRestorePrompt(null);
        } catch (error: unknown) {
            const message =
                formatInvokeError(error);
            if (message === 'name_taken' || message === 'origin_missing') {
                setRestorePrompt({ file, code: message });
            } else {
                setFileNotice({ tone: 'failed', text: message, details: [] });
            }
        } finally {
            markBusy([key], false);
        }
    }

    const folderListingForLayout =
        orderedImages.length === 0 &&
        (view.folders.length > 0 ||
            folderExitingKey !== null ||
            folderListingBusy);
    const photoGalleryActive = orderedImages.length > 0;
    const topNavPeekEnabled =
        photoGalleryActive && preferences.panelsPeekOnEdge;
    const topNavChrome = !topNavPeekEnabled || topNavVisible || topNavPinned;
    const scrollbarBottomOpen = !(
        preferences.panelsPeekOnEdge &&
        !toolbarVisible &&
        !toolbarPinned &&
        !bottomToolbarForced
    );

    const displayFolders = albumFolderTiles;
    const favoritesFolderVisibility =
        view.path && !view.serviceRole
            ? resolveFavoritesFolderVisibility({
                  albumDirectory: view.path,
                  pendingCreate: favoritesFolderPendingCreate,
                  hiddenFolderKeys: optimisticHiddenFolderKeys,
                  folders: view.folders,
                  hasActiveFavoriteAdds:
                      favoritesCoordinatorRef.current.hasActiveAddIntentsForDirectory(
                          view.path,
                      ),
              })
            : 'visible';
    useLayoutEffect(() => {
        const pending = folderFlipPendingRef.current;
        const grid = folderGridRef.current;
        folderFlipPendingRef.current = null;
        if (!pending || !grid || pending.size === 0) {
            return;
        }
        playFolderTileFlip(grid, pending, FOLDER_HEADER_MORPH_MS);
    }, [displayFolders]);
    const folderTiles =
        displayFolders.length === 0 ? null : (
            <div
                ref={folderGridRef}
                key={directoryKey ?? 'home'}
                className={styles.folderGrid}
            >
                {displayFolders.map((folder) => (
                    <FolderViewTile
                        key={pathKey(folder.path)}
                        folder={folder}
                        tipClassName={styles.folderTip}
                        pendingCreate={
                            view.path
                                ? favoritesFolderTileIsPendingCreate(
                                      folder,
                                      favoritesFolderVisibility,
                                      favoritesFolderPendingCreate,
                                      view.path,
                                  )
                                : false
                        }
                        entering={
                            folderEnteringKey !== null &&
                            pathKey(folder.path) === folderEnteringKey
                        }
                        exiting={
                            folderExitingKey !== null &&
                            pathKey(folder.path) === folderExitingKey
                        }
                        onOpen={(path) => void load(path)}
                        onContextMenu={(event, target) => {
                            folderContext.openFolderContextMenu(
                                event,
                                target,
                                view.path ?? "",
                            );
                        }}
                        onPointerEnter={() =>
                            hoverRef.current?.enterFolder(folder.path)
                        }
                        onPointerLeave={() =>
                            hoverRef.current?.leaveFolder(folder.path)
                        }
                    >
                        {folder.kind === 'drive' ? (
                            <StitchVueIcon
                                name={driveIconName(folder.media)}
                                className={styles.driveIcon}
                            />
                        ) : serviceFolderIcon(folder.serviceRole) ? (
                            <StitchVueIcon
                                name={
                                    serviceFolderIcon(folder.serviceRole) ??
                                    'folder'
                                }
                                className={`${styles.folderIcon} ${styles.serviceFolderIcon}`}
                            />
                        ) : (
                            <FolderIcon className={styles.folderIcon} />
                        )}
                    </FolderViewTile>
                ))}
            </div>
        );
    const photos =
        orderedImages.length === 0 ? null : (
            <div className={styles.photoSection}>
                <StitchVueGrid
                    folderHeader={folderTiles}
                    folderHeaderKey={displayFolders
                        .map((folder) => pathKey(folder.path))
                        .join('\n')}
                    animateHeaderHeight={
                        folderHeaderMorph && preferences.animationsEnabled
                    }
                    onHeaderMorphEnd={() => setFolderHeaderMorph(false)}
                    folderHeaderExiting={
                        folderExitingKey !== null && view.folders.length === 1
                    }
                    files={orderedImages}
                    listingComplete={status === 'ready'}
                    meta={metaRef.current}
                    thumbs={thumbsRef.current}
                    failed={failedRef.current}
                    failedVersion={failedVersion}
                    rowsPerScreen={rowsPerScreen}
                    fit={fit}
                    layoutMode={layoutMode}
                    metaVersion={metaVersion}
                    paintVersion={thumbVersion + failedVersion + metaVersion}
                    layoutWidthFreeze={
                        fsLayoutFreeze?.width ?? sidebarLayoutWidthFreeze
                    }
                    layoutHeightFreeze={fsLayoutFreeze?.height ?? null}
                    layoutInsetAnimating={
                        sidebarLayoutWidthFreeze !== null || sidebarLayoutMorph
                    }
                    viewportRef={photoGridViewportRef}
                    galleryViewportScrollSyncRef={galleryViewportScrollSyncRef}
                    onVisible={reportVisible}
                    onGeometryRange={reportGeometry}
                    onScrollActivity={reportGalleryScrollActivity}
                    onOpen={(index) => {
                        const file = orderedRef.current[index];
                        if (file) {
                            hoverRef.current?.reservePhotoForOpen(file);
                        }
                        setViewerIndex((current) =>
                            current === index ? null : index,
                        );
                    }}
                    onHoverPhoto={(index, inside) => {
                        const file = orderedRef.current[index];
                        if (!file) {
                            return;
                        }
                        if (inside) {
                            hoverRef.current?.enterPhoto(file);
                        } else {
                            hoverRef.current?.leavePhoto(file.path);
                        }
                    }}
                    onToggleSelect={toggleAt}
                    onExtendSelect={extendAt}
                    onClearSelect={() => {
                        if (settingsOpenRef.current || confirmMoveRef.current) {
                            return;
                        }
                        setSelection(
                            emptySelection(
                                viewRef.current.path
                                    ? pathKey(viewRef.current.path)
                                    : null,
                            ),
                        );
                    }}
                    onFavorite={(index) => {
                        const file = orderedRef.current[index];
                        if (file) {
                            void toggleFavoriteFile(file);
                        }
                    }}
                    onRestore={(index) => {
                        const file = orderedRef.current[index];
                        if (file) {
                            void restoreFile(file);
                        }
                    }}
                    onTrashMultiSelectBlocked={showTrashMultiSelectToast}
                    onDelete={
                        inFavorites
                            ? undefined
                            : (index) => {
                                  const file = orderedRef.current[index];
                                  if (file) {
                                      runFileAction('move_to_local_trash', [
                                          file,
                                      ]);
                                  }
                              }
                    }
                    selectedKeys={selectedKeys}
                    selectionMode={inTrash ? false : selectionMode}
                    busy={fileOpInThisFolder}
                    busyPaths={busyPaths}
                    inFavorites={inFavorites}
                    inTrash={inTrash}
                    favoritePaths={favoritePaths}
                    resolveFavoriteStar={resolveFavoriteStar}
                    showDates={preferences.showPhotoDates}
                    orderStamp={orderStamp}
                    photoFlip={photoFlip}
                    onPhotoFlipSettled={(generation) => {
                        setPhotoFlip((current) =>
                            current && current.generation === generation
                                ? null
                                : current,
                        );
                    }}
                    restoreScrollTop={scrollRestore.top}
                    restoreToken={scrollRestore.token}
                    directoryKey={directoryKey}
                    scrollbarTopOpen={topNavChrome}
                    scrollbarBottomOpen={scrollbarBottomOpen}
                    bottomOverlayReserve={bottomOverlayReserve}
                    onZoom={setRowsPerScreen}
                />
            </div>
        );

    return (
        <main
            ref={shellRef}
            className={styles.shell}
            style={{
                ['--pg-sidebar-width' as string]: `${sidebarWidth}px`,
                ['--pg-notice-bottom' as string]: `${bottomOverlayReserve}px`,
            }}
            data-sidebar-pinned={sidebarPinned ? 'true' : 'false'}
            data-sidebar-inset-anim={
                sidebarLayoutWidthFreeze !== null || sidebarLayoutMorph
                    ? 'true'
                    : 'false'
            }
            data-folder-listing={folderListingForLayout ? 'true' : 'false'}
            data-topnav-chrome={topNavChrome ? 'true' : 'false'}
            data-focus-mode={appFullscreen ? 'true' : 'false'}
            data-fullscreen-phase={fullscreenPhase}
            data-animations-enabled={
                preferences.animationsEnabled ? 'true' : 'false'
            }
            data-topnav-peek={topNavPeekEnabled ? 'true' : 'false'}
            data-topnav-visible={
                topNavVisible || !photoGalleryActive ? 'true' : 'false'
            }
            data-topnav-pinned={topNavPinned ? 'true' : 'false'}
            data-toolbar-peek={preferences.panelsPeekOnEdge ? 'true' : 'false'}
            data-toolbar-visible={toolbarVisible ? 'true' : 'false'}
            data-toolbar-pinned={toolbarPinned ? 'true' : 'false'}
            data-selection-active={bottomToolbarForced ? 'true' : 'false'}
            onMouseDown={(event) => {
                if (event.button === 3 || event.button === 4) {
                    event.preventDefault();
                }
            }}
            onMouseUp={(event) => {
                if (event.button === 3) {
                    goHistory(-1);
                } else if (event.button === 4) {
                    goHistory(1);
                }
            }}
            onMouseMove={(event) => {
                if (
                    !overlayBlocksToolbarPeek &&
                    preferences.panelsPeekOnEdge &&
                    !sidebarPinned
                ) {
                    if (event.clientX < 16) {
                        setSidebarPeek(true);
                    } else if (event.clientX > sidebarWidth + 48) {
                        setSidebarPeek(false);
                    }
                }
                if (topNavPeekEnabled && !topNavPinned) {
                    const shellRect =
                        event.currentTarget.getBoundingClientRect();
                    setTopNavVisible(
                        topNavPeekShouldShow(
                            event.clientX,
                            event.clientY,
                            shellRect,
                            event.target,
                        ),
                    );
                }
            }}
            onMouseLeave={(event) => {
                if (topNavPeekEnabled && !topNavPinned) {
                    const shellRect =
                        event.currentTarget.getBoundingClientRect();
                    if (
                        !topNavPeekShouldShow(
                            event.clientX,
                            event.clientY,
                            shellRect,
                            event.target,
                        )
                    ) {
                        setTopNavVisible(false);
                    }
                }
                if (
                    !overlayBlocksToolbarPeek &&
                    preferences.panelsPeekOnEdge &&
                    !toolbarPinned &&
                    !toolbarMenuHold.current
                ) {
                    const shellRect =
                        event.currentTarget.getBoundingClientRect();
                    const fromBottom = toolbarPeekDistanceFromBottom(
                        event.clientY,
                        shellRect.bottom,
                    );
                    // Уход ниже панели / за низ окна — не гасить peek (как title bar у верхней nav).
                    if (toolbarPeekShouldKeepOnLeave(fromBottom)) {
                        window.clearTimeout(toolbarHideTimer.current);
                        toolbarHideTimer.current = 0;
                        return;
                    }
                    window.clearTimeout(toolbarHideTimer.current);
                    toolbarHideTimer.current = window.setTimeout(() => {
                        setToolbarVisible(false);
                        toolbarHideTimer.current = 0;
                    }, 400);
                }
            }}
        >
            <div
                ref={galleryLayerRef}
                className={styles.galleryLayer}
            >
                {galleryEmptyCopy ? (
                    <div
                        className={styles.emptyGallery}
                        role="status"
                    >
                        <StitchVueIcon
                            name="file-image"
                            className={styles.emptyGalleryIcon}
                            aria-hidden
                        />
                        <p className={styles.emptyGalleryTitle}>
                            {t(galleryEmptyCopy.titleKey)}
                        </p>
                        <p className={styles.emptyGalleryDescription}>
                            {/* openError: живой текст ошибки; полная i18n — C-002 */}
                            {galleryEmptyKind === 'openError'
                                ? error
                                : t(galleryEmptyCopy.descriptionKey)}
                        </p>
                    </div>
                ) : null}
                {photos ?? folderTiles}
            </div>

            <FolderSidebar
                drives={drivesState.drives}
                drivesStatus={drivesState.status}
                selectedPath={view.path}
                pinned={sidebarPinned}
                peek={sidebarPeek}
                onPeek={setSidebarPeek}
                onTogglePin={toggleSidebarPin}
                onOpen={(path) => void load(path)}
                onHoverFolder={(path, inside) => {
                    if (inside) {
                        hoverRef.current?.enterFolder(path);
                    } else {
                        hoverRef.current?.leaveFolder(path);
                    }
                }}
                onHome={() => void load(null)}
                onRetryDrives={() => refreshDrives(true)}
                pathCopied={pathCopied}
                onCopyPath={copyPath}
                width={sidebarWidth}
                onResizeWidth={(next) =>
                    setSidebarWidth(clampSidebarWidth(next, window.innerWidth))
                }
                onFolderContextMenu={folderContext.openFolderContextMenu}
                hiddenFolderPathKeys={optimisticHiddenFolderKeys}
            />

            <div
                className={styles.topBarDock}
                data-top-nav-dock="true"
            >
                <TopNavigationBar
                    path={view.path}
                    canBack={history.index > 0}
                    canForward={history.index < history.entries.length - 1}
                    canUp={view.path !== null}
                    pinned={topNavPinned}
                    pathCopied={pathCopied}
                    onBack={() => goHistory(-1)}
                    onForward={() => goHistory(1)}
                    onUp={() => void load(view.parent ?? null)}
                    onNavigate={(path) => void load(path)}
                    onCopyPath={copyPath}
                    onTogglePin={() => setTopNavPinned((value) => !value)}
                    onOpenFolder={() => void openFolder()}
                    onFolderContextMenu={folderContext.openFolderPathContextMenu}
                />
            </div>

            <div
                ref={bottomBarDockRef}
                className={styles.bottomBarDock}
                data-dock="toolbar"
                onMouseEnter={() => {
                    if (!toolbarPinned && preferences.panelsPeekOnEdge) {
                        window.clearTimeout(toolbarHideTimer.current);
                        toolbarHideTimer.current = 0;
                        setToolbarVisible(true);
                    }
                }}
            >
                <div className={styles.bottomStack}>
                    {showBulkSelectionBar ? fileActions(null) : null}
                    <div className={styles.bottomBarRow}>
                        <BottomControlBar
                            layoutMode={layoutMode}
                            zoomIndex={zoomIndex(rowsPerScreen)}
                            zoomSteps={ZOOM_STEPS.length}
                            zoomEnabled={view.images.length > 0}
                            appFullscreen={appFullscreen}
                            toolbarPinned={toolbarPinned}
                            canBack={history.index > 0}
                            canForward={
                                history.index < history.entries.length - 1
                            }
                            onOpenFolder={() => void openFolder()}
                            onBack={() => goHistory(-1)}
                            onForward={() => goHistory(1)}
                            onLayoutMode={setLayoutMode}
                            onZoomIndex={(index) =>
                                setRowsPerScreen(rowsFromZoomIndex(index))
                            }
                            onZoomOut={() =>
                                setRowsPerScreen((value) => nextZoom(value, -1))
                            }
                            onZoomIn={() =>
                                setRowsPerScreen((value) => nextZoom(value, 1))
                            }
                            onToggleAppFullscreen={toggleAppFullscreen}
                            onToggleToolbarPin={() =>
                                setToolbarPinned((value) => !value)
                            }
                            onOpenSettings={() => setSettingsOpen(true)}
                            sort={gallerySort}
                            selectionMode={inTrash ? false : selectionMode}
                            selectionModeAvailable={!inTrash}
                            settingsButtonRef={settingsTriggerRef}
                            onSortKey={(key) =>
                                setGallerySort((current) =>
                                    applySortPress(current, key),
                                )
                            }
                            onMenuHold={holdToolbarForMenu}
                            onToggleSelectionMode={() => {
                                if (inTrash) {
                                    return;
                                }
                                const next = toggleSelectionModeButton(
                                    selectionMode,
                                    directoryKey,
                                );
                                setSelectionMode(next.selectionMode);
                                setSelection(next.selection);
                            }}
                        />
                        {folderThumbsLoading || photoGalleryActive ? (
                            <GalleryScrollJumpButton
                                pointUp={scrollJump.pointUp}
                                loading={folderThumbsLoading}
                                canScroll={scrollJump.canScroll}
                                sessionKey={directoryKey ?? ''}
                                progressRef={folderThumbLoaderRef}
                                onJump={jumpGalleryScroll}
                            />
                        ) : null}
                    </div>
                </div>
            </div>

            <SettingsDialog
                open={settingsOpen}
                preferences={preferences}
                usage={usage}
                returnFocusRef={settingsTriggerRef}
                onClose={() => setSettingsOpen(false)}
                onPreferencesChange={(patch) =>
                    setPreferences(savePreferences(patch))
                }
                onResetDefaults={() => {
                    const next = resetPreferencesToDefaults();
                    clearGallerySessionMemory();
                    setPreferences(next);
                    setLayoutMode(next.defaultLayoutMode);
                    setRowsPerScreen(ZOOM_DEFAULT);
                    // resetPreferences пишет locale в storage, но не переключает i18n
                    void setAppLocale(next.locale);
                }}
                onClearCache={clearCache}
                onCacheLimit={setLimit}
                onCacheTtl={setTtl}
                ttlPreset={ttlPreset(usage?.ttlSecs)}
            />

            {viewerMounted && viewerFileDisplay && (
                <ImageViewer
                    file={viewerFileDisplay}
                    motionPhase={viewerMotionPhase}
                    meta={metaRef.current.get(viewerFileDisplay.path)}
                    thumb={thumbsRef.current.get(viewerFileDisplay.path)}
                    thumbVersion={thumbVersion}
                    canGoPrev={viewerIndexDisplay > 0}
                    canGoNext={viewerIndexDisplay < orderedImages.length - 1}
                    onClose={() => {
                        setViewerIndex(null);
                        setMetaVersion((value) => value + 1);
                        void syncDisplayRotations(
                            orderedImages.map((file) => file.path),
                        );
                    }}
                    onNavigate={(delta) =>
                        setViewerIndex((index) => {
                            if (index === null) {
                                return null;
                            }
                            return Math.min(
                                orderedImages.length - 1,
                                Math.max(0, index + delta),
                            );
                        })
                    }
                    toolbarExtra={
                        !inTrash &&
                        shouldShowSelectionActions(
                            liveSelection.paths.length,
                            fileProgressText !== null,
                        )
                            ? fileActions(
                                  selectionMode
                                      ? {
                                            selected: selectedKeys.has(
                                                pathKey(viewerFileDisplay.path),
                                            ),
                                            onToggle: () =>
                                                toggleAt(viewerIndexDisplay),
                                        }
                                      : null,
                              )
                            : null
                    }
                    metaVersion={metaVersion}
                    onRotate={() =>
                        void rotateDisplayClockwise(viewerFileDisplay)
                    }
                    onOpenProperties={() =>
                        setPropertiesPath(viewerFileDisplay.path)
                    }
                    favoriteOn={resolveFavoriteStar(
                        pathKey(viewerFileDisplay.path),
                    )}
                    favoriteDisabled={
                        fileOperation !== null ||
                        busyPaths.has(pathKey(viewerFileDisplay.path))
                    }
                    onFavorite={
                        inTrash
                            ? undefined
                            : () => void toggleFavoriteFile(viewerFileDisplay)
                    }
                    deleteDisabled={
                        fileOperation !== null ||
                        unfavoriteBusy ||
                        busyPaths.has(pathKey(viewerFileDisplay.path))
                    }
                    onDelete={
                        inTrash || inFavorites
                            ? undefined
                            : () => {
                                  runFileAction('move_to_local_trash', [
                                      viewerFileDisplay,
                                  ]);
                              }
                    }
                    restoreDisabled={
                        fileOperation !== null ||
                        busyPaths.has(pathKey(viewerFileDisplay.path))
                    }
                    onRestore={
                        inTrash
                            ? () => void restoreFile(viewerFileDisplay)
                            : undefined
                    }
                    recycleDisabled={
                        fileOperation !== null ||
                        busyPaths.has(pathKey(viewerFileDisplay.path))
                    }
                    onRecycleToWindows={
                        inTrash
                            ? () => void recycleTrashFile(viewerFileDisplay)
                            : undefined
                    }
                    modalOpen={propertiesPath !== null}
                />
            )}
            <PhotoPropertiesDialog
                open={propertiesPath !== null}
                path={propertiesPath}
                originPath={inTrash ? trashOriginPath : null}
                onClose={() => setPropertiesPath(null)}
            />
            <ConfirmMoveDialog
                open={restorePrompt !== null}
                text={
                    restorePrompt ? restorePromptText(restorePrompt.code) : ''
                }
                confirmLabel={
                    restorePrompt?.code === 'name_taken'
                        ? t('selection.restoreOtherName')
                        : restorePrompt?.code === 'origin_missing'
                          ? t('selection.restoreChooseFolder')
                          : t('common.okUnderstood')
                }
                onCancel={() => setRestorePrompt(null)}
                onConfirm={() => {
                    const prompt = restorePrompt;
                    if (!prompt) {
                        return;
                    }
                    if (prompt.code === 'name_taken') {
                        void restoreFile(prompt.file, 'renamed');
                    } else if (prompt.code === 'origin_missing') {
                        void selectFolder().then((directory) => {
                            if (directory) {
                                void restoreFile(
                                    prompt.file,
                                    'chosen',
                                    directory,
                                );
                            }
                        });
                    } else {
                        setRestorePrompt(null);
                    }
                }}
            />
            {fileNotice ? (
                <OperationNoticeView
                    notice={fileNotice}
                    onUndo={
                        fileNotice.undoIds && fileNotice.undoIds.length > 0
                            ? () =>
                                  void undoFavoriteRemovals(
                                      fileNotice.undoIds ?? [],
                                  )
                            : undefined
                    }
                    onDismiss={() => {
                        const ids = fileNotice.undoIds ?? [];
                        setFileNotice(null);
                        for (const id of ids) {
                            void invoke('discard_favorite_undo', { id });
                        }
                    }}
                />
            ) : null}
            <ConfirmMoveDialog
                open={confirmMove !== null}
                text={confirmMove ? confirmMoveText(confirmMove.length) : ''}
                onCancel={() => setConfirmMove(null)}
                onConfirm={() => {
                    const files = confirmMove;
                    if (!files) {
                        return;
                    }
                    setConfirmMove(null);
                    runFileAction('move_to_local_trash', files, true);
                }}
            />
            <FavoriteTrashUnfavoriteDialog
                open={favoriteTrashUnfavorite !== null}
                variant="single"
                busy={
                    favoriteTrashUnfavorite !== null &&
                    busyPaths.has(pathKey(favoriteTrashUnfavorite.path))
                }
                onCancel={() => setFavoriteTrashUnfavorite(null)}
                onRemoveCopy={() => {
                    const file = favoriteTrashUnfavorite;
                    if (file) {
                        void resolveTrashUnfavorite(file, 'recycle_copy');
                    }
                }}
                onRestoreOrigin={() => {
                    const file = favoriteTrashUnfavorite;
                    if (file) {
                        void resolveTrashUnfavorite(file, 'restore_origin');
                    }
                }}
            />
            <FavoriteMissingOriginDialog
                open={favoriteMissingOrigin !== null}
                busy={
                    favoriteMissingOrigin !== null &&
                    busyPaths.has(pathKey(favoriteMissingOrigin.file.path))
                }
                showRecycle
                onCancel={cancelMissingOriginUnfavorite}
                onReturnToSource={() => {
                    void resolveMissingOriginUnfavorite('return_to_source');
                }}
                onChooseFolder={() => resolveMissingOriginChooseFolder()}
                onKeepCopy={() => {
                    void resolveMissingOriginUnfavorite('keep_copy');
                }}
                onRecycleCopy={() => {
                    void resolveMissingOriginUnfavorite('recycle_copy');
                }}
            />
            <FavoriteTrashUnfavoriteDialog
                open={massTrashUnfavoriteOpen}
                variant="batch"
                batchCounts={massTrashBatchCounts}
                onCancel={cancelMassTrashUnfavorite}
                onRemoveCopy={() => confirmMassTrashUnfavorite('recycle_copy')}
                onRestoreOrigin={() =>
                    confirmMassTrashUnfavorite('restore_origin')
                }
            />
            <ConfirmMoveDialog
                open={unfavoritePrompt !== null}
                text={
                    unfavoritePrompt?.mode === 'batch'
                        ? batchUnfavoritePromptCopy(
                              unfavoritePrompt.files.length,
                          ).text
                        : unfavoritePrompt?.mode === 'single'
                          ? unfavoritePromptCopy(unfavoritePrompt.kind).text
                          : ''
                }
                detail={
                    unfavoritePrompt?.mode === 'batch' &&
                    unfavoritePrompt.confirmLines.length > 0
                        ? (
                              <ul className={selectionActionsStyles.dialogList}>
                                  {unfavoritePrompt.confirmLines.map(
                                      (line) => (
                                          <li key={line.basename + line.kind}>
                                              {line.basename} — {line.label}
                                          </li>
                                      ),
                                  )}
                              </ul>
                          )
                        : undefined
                }
                confirmLabel={
                    unfavoritePrompt?.mode === 'batch'
                        ? batchUnfavoritePromptCopy(
                              unfavoritePrompt.files.length,
                          ).confirmLabel
                        : unfavoritePrompt?.mode === 'single'
                          ? unfavoritePromptCopy(unfavoritePrompt.kind)
                                .confirmLabel
                          : t('selection.favoriteMoveLabel')
                }
                cancelLabel={
                    unfavoritePrompt?.mode === 'batch'
                        ? t('selection.favoriteBatchSkipLabel')
                        : t('common.cancel')
                }
                onCancel={() => {
                    const prompt = unfavoritePrompt;
                    if (prompt?.mode === 'batch') {
                        skipBatchUnfavorite(prompt.files);
                        return;
                    }
                    setUnfavoritePrompt(null);
                }}
                onConfirm={() => {
                    const prompt = unfavoritePrompt;
                    if (!prompt) {
                        return;
                    }
                    if (prompt.mode === 'batch') {
                        setUnfavoritePrompt(null);
                        void confirmBatchUnfavorite(prompt.files);
                        return;
                    }
                    setUnfavoritePrompt(null);
                    void toggleFavoriteFile(prompt.file, true);
                }}
            />
            <GallerySupportReminder
                galleryReady={!folderListingBusy}
                viewerOpen={viewerMounted}
                overlayOpen={
                    overlayBlocksToolbarPeek ||
                    folderContext.folderDialogsOpen ||
                    folderContext.folderContextMenuOpen
                }
                fileOpsBusy={fileOperation !== null || unfavoriteBusy}
                fullscreenTransition={fullscreenPhase !== 'idle'}
            />
            {folderContext.contextUi}
            {selectionDiagEnabled() ? <SelectionDiagOverlay /> : null}
        </main>
    );

    async function setLimit(bytes: number): Promise<CacheUsage> {
        const next = await invoke<CacheUsage>('set_cache_limit', { bytes });
        setUsage(next);
        return next;
    }

    async function setTtl(preset: string): Promise<CacheUsage> {
        const next = await invoke<CacheUsage>('set_cache_ttl', { preset });
        setUsage(next);
        return next;
    }
}

