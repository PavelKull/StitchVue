import { invoke } from '@tauri-apps/api/core';
import { samePathList, samePathSet } from './indexingPathEquality';
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
import { setWindowFullscreen } from '../../features/app-fullscreen/appFullscreenWindow';
import { useAppFullscreen } from '../../features/app-fullscreen/useAppFullscreen';
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
import { coalesceFolderRefresh } from '../../features/gallery/folderRefresh';
import {
    createDeferredVoid,
    listingHasTrustedGeometry,
} from '../../features/gallery/galleryGeometryGate';
import { useGalleryPipelineEvents } from '../../features/gallery/galleryPipelineEvents';
import {
    applyDrivesSnapshot,
    initialDrivesState,
    type DrivesState,
} from '../../features/folder/drivesState';
import { listDrives } from '../../features/folder/listDrives';
import {
    browseDirectory,
    selectFolder,
} from '../../features/select-folder/selectFolder';
import { driveIconName } from '../../features/gallery/driveIcon';
import { listingStamp } from '../../features/gallery/galleryListing';
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
    type GallerySort,
} from '../../features/gallery/galleryOrder';
import {
    createGalleryHover,
    setHoverFolderSession,
    viewerEdge,
} from '../../features/gallery/galleryHover';
import {
    hoverWindow,
    type HoverController,
} from '../../features/gallery/hoverPrefetch';
import {
    forgetHotFolder,
    recallHotFolder,
    rememberHotFolder,
    retainUnchanged,
} from '../../features/gallery/folderHotCache';
import {
    folderThumbnailsPending as computeFolderThumbnailsPending,
    markThumbSettled,
    seedSettledThumbKeys,
} from '../../features/gallery/folderThumbnailsPending';
import { fetchPipelineStats } from '../../features/gallery/pipelineStats';
import {
    aheadForInterval,
    isFastPace,
    smoothInterval,
} from '../../features/gallery/viewerPace';
import {
    cancelViewerPreload,
    notifyNeighborThumbs,
    preloadViewerNeighbors,
} from '../../features/gallery/viewerPreload';
import {
    clampSidebarWidth,
    loadPanelMemory,
    savePanelMemory,
} from '../../features/gallery/panelMemory';
import {
    toolbarPeekDistanceFromBottom,
    toolbarPeekShouldKeepOnLeave,
} from '../../features/gallery/toolbarPeekGeometry';
import { topNavPeekShouldShow } from '../../features/gallery/topNavPeekGeometry';
import { useGalleryPanelPeek } from '../../features/gallery/useGalleryPanelPeek';
import { useGalleryBottomOverlayReserve } from '../../features/gallery/useGalleryBottomOverlayReserve';
import { useGalleryScrollActivity } from '../../features/gallery/useGalleryScrollActivity';
import { useGalleryScrollJump } from '../../features/gallery/useGalleryScrollJump';
import { FolderIcon } from '../../shared/icons/SvgIcon';
import { StitchVueIcon } from '../../shared/icons/StitchVueIcon';
import {
    addRange,
    emptySelection,
    isClearSelectionHotkey,
    isSelectAllHotkey,
    isTypingTarget,
    pathKey,
    pruneSelection,
    selectAll,
    togglePath,
    type SelectionState,
} from '../../features/selection/selection';
import {
    clearSelectionPaths,
    enterSelectionMode,
    escapeSelection,
    resetSelectionOnFolderChange,
    resolveUnfavoriteParentDirectory,
    selectionAfterMassUnfavorite,
    shouldShowSelectionActions,
    toggleSelectionModeButton,
} from '../../features/selection/selectionMode';
import { SelectionDiagOverlay } from '../../features/selection/SelectionDiagOverlay';
import {
    installSelectionDiagGlobals,
    selectionDiag,
    selectionDiagEnabled,
    selectionDiagKey,
} from '../../features/selection/selectionDiag';
import {
    commandAvailability,
    confirmMoveText,
    needsMoveConfirm,
    operationId,
    operationNotice,
    progressLabel,
    summarize,
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
} from '../../features/selection/fileOperation';
import {
    batchUnfavoriteConfirmLines,
    batchUnfavoritePromptCopy,
    type BatchUnfavoriteConfirmLine,
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
    type UnfavoriteBatchItemResult,
    type UnfavoriteCleanupOutcome,
} from '../../features/selection/removeFavoritesBatch';
import { logUnfavoriteBatchClassifyDebug } from '../../features/selection/unfavoriteClassifyDiag';
import {
    beginUnfavorite,
    beginUnfavoriteConfirmPass,
    canStartUnfavorite,
    endUnfavorite,
    idleUnfavoriteGate,
    markUnfavoriteConfirmPending,
    type UnfavoriteGate,
} from '../../features/selection/unfavoriteGate';
import {
    applyFavoriteOverlayPending,
    applyFavoriteOverlayPendingBatch,
    clearFavoriteOverlayForOperation,
    clearFavoriteOverlayIfGeneration,
    clearFavoriteOverlayKey,
    favoriteDisplayOn,
    isFavoriteOverlayPending,
    mapSnapshotCopyOrigins,
    nextFavoriteOverlayGeneration,
    type FavoriteOverlayMap,
} from '../../features/favorites/favoriteOptimisticOverlay';
import {
    beginFavoritePathsFetch,
    bumpFavoritePathsConfirmedRevision,
    needsFavoritePathsResyncAfterStaleReject,
    resolveFavoritePathsFetch,
    type FavoritePathsSyncCounters,
} from '../../features/favorites/favoritePathsServerSync';
import {
    browseErrorLooksLikeMissingFolder,
    favoritesActivityAfterRename,
} from '../../features/favorites/favoritesCollectionLifecycle';
import {
    copyOriginRowsFromCache,
    ensureFavoriteCopyOriginCacheScope,
    mergeFavoriteCopyOriginCache,
    nextFavoritesFolderHideGeneration,
    shouldOptimisticallyHideFavoritesServiceFolder,
    type FavoritesServiceFolderHideOverlay,
} from '../../features/favorites/favoriteMassUnfavoriteOptimistic';
import {
    buildFavoriteOptimisticMemorySnapshot,
    installFavoriteOptimisticMemoryDiag,
} from '../../features/favorites/favoriteOptimisticMemoryDiag';
import { cleanupEmptyServiceFolder } from '../../features/folder/folderMenu';
import {
    ConfirmMoveDialog,
    OperationNoticeView,
    SelectionActions,
} from '../../widgets/selection-actions/SelectionActions';
import selectionActionsStyles from '../../widgets/selection-actions/SelectionActions.module.scss';
import { FolderSidebar } from '../../widgets/folder-sidebar/FolderSidebar';
import { orderFoldersForDisplay } from '../../features/folder/folderOrder';
import { insertServiceFolder } from '../../features/folder/insertServiceFolder';
import {
    captureFolderTileRects,
    playFolderTileFlip,
} from '../../features/folder/folderTileFlip';
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
} from '../../features/settings/gallerySessionMemory';
import {
    loadPreferences,
    resetPreferencesToDefaults,
    savePreferences,
    type AppPreferences,
} from '../../features/settings/settingsPreferences';
import { FOLDER_HEADER_TOP_PX } from '../../widgets/gallery-grid/folderHeaderScroll';
import {
    firstGeometryRange,
    GEOMETRY_FIRST_WAIT_MS,
} from '../../widgets/gallery-grid/layout';
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
import { SettingsDialog } from '../../widgets/settings-dialog/SettingsDialog';
import { ImageViewer } from '../../widgets/image-viewer/ImageViewer';
import { PhotoPropertiesDialog } from '../../widgets/photo-properties/PhotoPropertiesDialog';
import { TopNavigationBar } from '../../widgets/top-navigation-bar/TopNavigationBar';
import { useExternalFileDrop } from '../../features/gallery/externalDrop';
import { usePathCopyFeedback } from '../../shared/hooks/usePathCopyFeedback';
import {
    recycleLocalTrashFile,
    trashEntryOrigin,
} from '../../features/trash/trashApi';
import { useTranslation } from 'react-i18next';
import {
    createEmptyView,
    withLocalizedDirectory,
} from '../../features/gallery/galleryDirectoryView';
import { indexPayload } from '../../features/gallery/galleryIndexPayload';
import { restorePromptText } from '../../features/gallery/restorePromptText';
import { useGalleryFolderHistory } from '../../features/gallery/useGalleryFolderHistory';
import { DISK_SERVICE_FOLDER_LEAF } from '../../entities/folder/serviceFolder';
import { formatInvokeError } from '../../shared/i18n';
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
    const [drivesState, setDrivesState] = useState<DrivesState>(() =>
        initialDrivesState(),
    );
    const drivesStateRef = useRef(drivesState);
    drivesStateRef.current = drivesState;
    const drivesRequestRef = useRef(0);
    const refreshDrivesRef = useRef<(force?: boolean) => void>(() => undefined);
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
    const viewerNavAt = useRef(0);
    const viewerIntervals = useRef<number[]>([]);
    const viewerDirection = useRef<1 | -1>(1);
    const viewerPrevious = useRef<number | null>(null);
    const [scrollRestore, setScrollRestore] = useState<{
        token: number;
        top: number;
    }>({ token: 0, top: 0 });
    const scrollRestoreToken = useRef(0);
    const [selectionMode, setSelectionMode] = useState(false);
    const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
    const shellRef = useRef<HTMLElement>(null);
    const photoGridViewportRef = useRef<HTMLDivElement>(null);
    const bottomBarDockRef = useRef<HTMLDivElement>(null);
    const [folderListingBusy, setFolderListingBusy] = useState(true);
    const [folderThumbnailsPending, setFolderThumbnailsPending] =
        useState(true);
    const folderListingBusyRef = useRef(true);
    folderListingBusyRef.current = folderListingBusy;
    const thumbSettledRef = useRef(new Set<string>());
    const thumbExpectedRef = useRef(new Set<string>());
    const thumbTotalRef = useRef(0);
    const thumbProgressSessionRef = useRef(0);
    const pipelinePassRef = useRef<string | null>(null);
    const pipelinePendingRef = useRef<number | null>(null);
    const cacheCappedRef = useRef(false);
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
    const [bootNotice, setBootNotice] = useState<string | null>(null);
    const settingsTriggerRef = useRef<HTMLButtonElement>(null);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const [selection, setSelection] = useState<SelectionState>(
        emptySelection(null),
    );
    const [fileOperation, setFileOperation] = useState<{
        id: string;
        action: FileAction | 'remove_from_favorites';
    } | null>(null);
    const [fileProgress, setFileProgress] =
        useState<FileOperationProgress | null>(null);
    const [unfavoriteBusy, setUnfavoriteBusy] = useState(false);
    const [fileNotice, setFileNotice] = useState<OperationNotice | null>(null);
    const [confirmMove, setConfirmMove] = useState<ImageFile[] | null>(null);
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
    const pipelineListenersReady = useRef(createDeferredVoid());
    const geometryNudgeSessionRef = useRef(0);
    const scanFolderRef = useRef<string | null>(null);
    const listingRescanRef = useRef(true);
    const resetScrollActivityRef = useRef<() => void>(() => undefined);
    const hoverRef = useRef<HoverController | null>(null);
    if (hoverRef.current == null) {
        hoverRef.current = createGalleryHover();
    }
    const viewRef = useRef(view);
    viewRef.current = view;
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const selectionModeRef = useRef(selectionMode);
    selectionModeRef.current = selectionMode;
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
    const { mounted: restoreOverlayMounted } = useAnimatedModal(
        restorePrompt !== null,
    );
    const overlayBlocksToolbarPeek =
        viewerMounted ||
        settingsOverlayMounted ||
        propertiesOverlayMounted ||
        confirmMoveOverlayMounted ||
        unfavoriteOverlayMounted ||
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
        confirmFiles: ImageFile[];
        priorResults: UnfavoriteBatchItemResult[];
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
    const favoriteCopyOriginCacheRef = useRef(new Map<string, string>());
    const favoriteCopyOriginCacheScopeRef = useRef<string | null>(null);
    const favoriteOriginLookupPendingRef = useRef(0);
    const optimisticFavoritesFolderHideRef =
        useRef<FavoritesServiceFolderHideOverlay | null>(null);
    const favoritesFolderHideGenerationsRef = useRef(new Map<string, number>());
    const [optimisticHiddenFolderKeys, setOptimisticHiddenFolderKeys] =
        useState<ReadonlySet<string>>(() => new Set());
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

    function releaseUnfavoriteGate() {
        const sessionId = unfavoriteGateRef.current.sessionId;
        if (sessionId) {
            teardownMassUnfavoritePresentation(sessionId);
            massUnfavoriteOriginRef.current = null;
            const hide = optimisticFavoritesFolderHideRef.current;
            if (hide && hide.operationId === sessionId) {
                optimisticFavoritesFolderHideRef.current = null;
                setOptimisticHiddenFolderKeys(new Set());
            }
        }
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
    const indexedPathsRef = useRef<string[]>([]);
    const thumbSeen = useRef(false);
    const noteThumbTimingRef = useRef<() => void>(() => undefined);
    const scrollTopRef = useRef(0);
    const layoutModeRef = useRef(layoutMode);
    layoutModeRef.current = layoutMode;
    const rowsRef = useRef(rowsPerScreen);
    rowsRef.current = rowsPerScreen;
    const refreshRef = useRef<(path: string) => void>(() => undefined);
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
    const commandsRef = useRef({
        clearSelection: () => undefined as void,
        selectAllImages: () => undefined as void,
        deleteSelection: () => undefined as void,
        closeSettings: () => undefined as void,
        closeConfirm: () => undefined as void,
        closeUnfavoritePrompt: () => undefined as void,
        closeViewer: () => undefined as void,
        selectViewerPhoto: () => undefined as void,
        exitFullscreen: () => undefined as void,
    });

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

    const refreshDrives = useCallback((force = false) => {
        if (!force && drivesStateRef.current.status === 'loading') {
            return;
        }
        const id = drivesRequestRef.current + 1;
        drivesRequestRef.current = id;
        const loading: DrivesState = {
            ...drivesStateRef.current,
            status: 'loading',
            error: null,
            requestId: id,
        };
        drivesStateRef.current = loading;
        setDrivesState(loading);
        void listDrives()
            .then((drives) => {
                if (id !== drivesRequestRef.current) {
                    return;
                }
                const next: DrivesState = {
                    status: 'success',
                    drives,
                    error: null,
                    requestId: id,
                };
                drivesStateRef.current = next;
                setDrivesState(next);
            })
            .catch((err: unknown) => {
                if (id !== drivesRequestRef.current) {
                    return;
                }
                const next: DrivesState = {
                    ...drivesStateRef.current,
                    status: 'error',
                    error: err instanceof Error ? err.message : String(err),
                    requestId: id,
                };
                drivesStateRef.current = next;
                setDrivesState(next);
            });
    }, []);
    refreshDrivesRef.current = refreshDrives;

    useEffect(() => {
        let cancelled = false;
        async function bootstrap() {
            refreshUsage();
            void invoke('set_storage_profile', { mode: 'auto' }).catch(
                () => undefined,
            );
            const prefs = loadPreferences();
            const memory = loadGallerySessionMemory();
            let startPath: string | null = null;
            if (prefs.rememberLastFolder && memory.lastFolderPath) {
                try {
                    const ok = await invoke<boolean>('directory_accessible', {
                        path: memory.lastFolderPath,
                    });
                    if (ok) {
                        startPath = memory.lastFolderPath;
                    } else if (!cancelled) {
                        setBootNotice(t('gallery.bootLastFolderUnavailable'));
                    }
                } catch {
                    if (!cancelled) {
                        setBootNotice(t('gallery.bootLastFolderFailed'));
                    }
                }
            }
            await pipelineListenersReady.current.promise;
            if (!cancelled) {
                refreshDrives(true);
                void load(startPath);
            }
        }
        void bootstrap();
        return () => {
            cancelled = true;
            // Abandon in-flight drive requests so a remount (Strict Mode / HMR) can start fresh
            // instead of staying stuck on "loading" with no live promise.
            drivesRequestRef.current += 1;
        };
    }, [refreshUsage, refreshDrives]);

    useEffect(() => {
        if (!bootNotice) {
            return;
        }
        const timer = window.setTimeout(() => setBootNotice(null), 6000);
        return () => window.clearTimeout(timer);
    }, [bootNotice]);

    useEffect(() => {
        return () => {
            void setWindowFullscreen(false);
        };
    }, []);

    useEffect(() => {
        installSelectionDiagGlobals();
        function onWindowKeyDown(event: globalThis.KeyboardEvent) {
            const commands = commandsRef.current;
            const typing = isTypingTarget(event.target);
            const blocks = {
                isTypingTarget: typing,
                confirmMove: confirmMoveRef.current !== null,
                unfavoritePrompt: unfavoritePromptRef.current !== null,
                settingsOpen: settingsOpenRef.current,
                unfavoriteBusy: unfavoriteGateRef.current.busy,
                viewerIndex: viewerIndexRef.current,
                selectionMode: selectionModeRef.current,
                selectedCount: selectionRef.current.paths.length,
            };
            if (
                selectionDiagEnabled() &&
                (event.ctrlKey ||
                    event.key === 'Escape' ||
                    event.key === 'Delete' ||
                    event.key === ' ')
            ) {
                selectionDiagKey(event, blocks);
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                if (propertiesPathRef.current) {
                    setPropertiesPath(null);
                } else if (confirmMoveRef.current) {
                    commands.closeConfirm();
                } else if (unfavoritePromptRef.current) {
                    commands.closeUnfavoritePrompt();
                } else if (settingsOpenRef.current) {
                    commands.closeSettings();
                } else if (viewerIndexRef.current !== null) {
                    commands.closeViewer();
                } else if (appFullscreenRef.current) {
                    commands.exitFullscreen();
                } else {
                    const directory = viewRef.current.path
                        ? pathKey(viewRef.current.path)
                        : null;
                    const cleared = escapeSelection(directory);
                    setSelectionMode(cleared.selectionMode);
                    setSelection(cleared.selection);
                }
                return;
            }
            if (typing) {
                selectionDiag('keydown-early-return', {
                    earlyReturn: 'isTypingTarget',
                    ...blocks,
                });
                return;
            }
            if (confirmMoveRef.current) {
                selectionDiag('keydown-early-return', {
                    earlyReturn: 'confirmMove',
                    ...blocks,
                });
                return;
            }
            if (unfavoritePromptRef.current) {
                selectionDiag('keydown-early-return', {
                    earlyReturn: 'unfavoritePrompt',
                    ...blocks,
                });
                return;
            }
            if (settingsOpenRef.current) {
                selectionDiag('keydown-early-return', {
                    earlyReturn: 'settingsOpen',
                    ...blocks,
                });
                return;
            }
            // Capture Ctrl+A early so WebView2 does not treat it as native "select all".
            if (isClearSelectionHotkey(event) || isSelectAllHotkey(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
            if (isClearSelectionHotkey(event)) {
                selectionDiag('ctrl-shift-a', {
                    action: 'clearSelection',
                    code: event.code,
                    key: event.key,
                    countBefore: selectionRef.current.paths.length,
                    ...blocks,
                });
                commands.clearSelection();
                return;
            }
            if (isSelectAllHotkey(event)) {
                const countBefore = selectionRef.current.paths.length;
                selectionDiag('ctrl-a', {
                    action: 'selectAllImages',
                    code: event.code,
                    key: event.key,
                    countBefore,
                    path: viewRef.current.path,
                    serviceRole: viewRef.current.serviceRole,
                    imageCount: viewRef.current.images.length,
                    ...blocks,
                });
                commands.selectAllImages();
                return;
            }
            if (event.key === 'Delete' && !fileOperationRef.current) {
                event.preventDefault();
                commands.deleteSelection();
            } else if (event.key === ' ' && viewerIndexRef.current !== null) {
                const target = event.target;
                if (
                    target instanceof HTMLElement &&
                    target.closest('button, a, input, textarea, select')
                ) {
                    selectionDiag('keydown-early-return', {
                        earlyReturn: 'space-on-control',
                        ...blocks,
                    });
                    return;
                }
                event.preventDefault();
                commands.selectViewerPhoto();
            }
        }
        window.addEventListener('keydown', onWindowKeyDown, true);
        return () =>
            window.removeEventListener('keydown', onWindowKeyDown, true);
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

    function syncFolderThumbnailsPending() {
        const next = computeFolderThumbnailsPending({
            listingBusy: folderListingBusyRef.current,
            imageCount: thumbTotalRef.current,
            settledCount: thumbSettledRef.current.size,
            pipelinePending: pipelinePendingRef.current,
            pipelinePass: pipelinePassRef.current,
            cacheCapped: cacheCappedRef.current,
        });
        setFolderThumbnailsPending((current) =>
            current === next ? current : next,
        );
    }

    function beginFolderThumbProgress(session: number) {
        thumbProgressSessionRef.current = session;
        thumbSettledRef.current = new Set();
        thumbExpectedRef.current = new Set();
        thumbTotalRef.current = 0;
        pipelinePassRef.current = null;
        pipelinePendingRef.current = null;
        cacheCappedRef.current = false;
        setFolderThumbnailsPending(true);
    }

    function seedFolderThumbProgress(
        session: number,
        images: readonly ImageFile[],
    ) {
        if (session !== thumbProgressSessionRef.current) {
            return;
        }
        thumbTotalRef.current = images.length;
        thumbExpectedRef.current = new Set(
            images.map((image) => pathKey(image.path)),
        );
        thumbSettledRef.current = seedSettledThumbKeys(
            images,
            thumbsRef.current,
            failedRef.current,
        );
        syncFolderThumbnailsPending();
    }

    function noteFolderThumbSettled(path: string, session: number) {
        if (session !== thumbProgressSessionRef.current) {
            return;
        }
        const key = pathKey(path);
        if (!thumbExpectedRef.current.has(key)) {
            return;
        }
        if (!markThumbSettled(thumbSettledRef.current, path)) {
            return;
        }
        syncFolderThumbnailsPending();
    }

    const noteBaseThumbReadyRef = useRef(noteFolderThumbSettled);
    noteBaseThumbReadyRef.current = noteFolderThumbSettled;
    const noteThumbFailedRef = useRef(noteFolderThumbSettled);
    noteThumbFailedRef.current = noteFolderThumbSettled;

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
        releaseUnfavoriteGate();
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
        await invoke('begin_directory_session', { session: id, folder: path });
        stashOpenFolder();
        scrollTopRef.current = 0;
        resetScrollActivityRef.current();
        scrollRestoreToken.current += 1;
        setScrollRestore({ token: scrollRestoreToken.current, top: 0 });
        const hot = path ? recallHotFolder(path) : null;
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
                folders: hot.folders,
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
            if (
                folderHide &&
                next.path &&
                pathKey(next.path) === pathKey(folderHide.parentDirectory) &&
                next.folders.some(
                    (folder) =>
                        pathKey(folder.path) === pathKey(folderHide.folderPath),
                )
            ) {
                beginFolderExitAnimation(pathKey(folderHide.folderPath));
            }
            if (record) {
                recordHistory(next.path);
            }
            if (next.path === null) {
                // Home browse already has drives; keep the sidebar in sync even if list_drives is slow or abandoned.
                const homeDrives = next.folders.filter(
                    (folder) => folder.kind === 'drive',
                );
                setDrivesState((current) => {
                    const applied = applyDrivesSnapshot(current, homeDrives);
                    drivesStateRef.current = applied;
                    return applied;
                });
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
                void invoke('start_indexing', {
                    folder: next.path,
                    files: indexPayload(sorted),
                    session: id,
                });
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
            void invoke('set_visible_range', {
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
        void invoke('set_geometry_range', { start, end });
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
            void invoke('set_geometry_range', {
                start: range.start,
                end: range.end,
            });
        }
    }

    async function openFolder() {
        const selected = await selectFolder();
        if (selected) {
            await load(selected);
        }
    }

    async function clearCache(): Promise<void> {
        await invoke('clear_cache');
        thumbsRef.current = new Map();
        setThumbVersion((value) => value + 1);
        refreshUsage();
        if (view.path && view.images.length > 0) {
            const sorted = sortPhotos(view.images, gallerySortRef.current);
            indexedPathsRef.current = sorted.map((file) => file.path);
            thumbSeen.current = false;
            await invoke('start_indexing', {
                folder: view.path,
                files: indexPayload(sorted),
                session: requestId.current,
            });
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
            setView((current) => ({
                ...current,
                folders: insertServiceFolder(current.folders, folderPath, role),
            }));
        },
        [],
    );

    const orderedImages = useMemo(
        () => sortPhotos(view.images, gallerySort),
        [view.images, gallerySort],
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

    const bottomOverlayReserve =
        useGalleryBottomOverlayReserve(bottomBarDockRef);
    const { scrollJump, jumpGalleryScroll, commitScrollJump } =
        useGalleryScrollJump({
            viewportRef: photoGridViewportRef,
            orderedImagesLength: orderedImages.length,
            directoryKey: directoryKey ?? '',
            layoutMode,
            rowsPerScreen,
            bottomOverlayReserve,
        });
    const { reportScrollActivity, resetScrollActivityForFolderChange } =
        useGalleryScrollActivity({
            scrollTopRef,
            viewportRef: photoGridViewportRef,
            commitScrollJump,
        });
    resetScrollActivityRef.current = resetScrollActivityForFolderChange;

    const orderedRef = useRef(orderedImages);
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

    useEffect(() => {
        if (!geometryPending || !view.path) {
            return;
        }
        const session = requestId.current;
        const folder = view.path;
        const files = orderedImages;
        if (geometryNudgeSessionRef.current === session) {
            return;
        }
        const timer = window.setTimeout(() => {
            if (requestId.current !== session) {
                return;
            }
            if (
                listingHasTrustedGeometry(
                    files,
                    metaRef.current,
                    failedRef.current,
                )
            ) {
                return;
            }
            if (geometryNudgeSessionRef.current === session) {
                return;
            }
            geometryNudgeSessionRef.current = session;
            indexedPathsRef.current = files.map((file) => file.path);
            void invoke('start_indexing', {
                folder,
                files: indexPayload(files),
                session,
            });
            reportGeometryRange(files.length);
        }, GEOMETRY_FIRST_WAIT_MS);
        return () => window.clearTimeout(timer);
    }, [
        geometryPending,
        view.path,
        orderedImages,
        metaVersion,
        failedVersion,
    ]);

    const folderThumbsLoading = folderListingBusy || folderThumbnailsPending;

    useEffect(() => {
        if (!folderThumbsLoading) {
            return;
        }
        let cancelled = false;
        const poll = async () => {
            try {
                const stats = await fetchPipelineStats();
                if (
                    cancelled ||
                    requestId.current !== thumbProgressSessionRef.current
                ) {
                    return;
                }
                pipelinePassRef.current = stats.pass;
                pipelinePendingRef.current = stats.pending;
                cacheCappedRef.current = stats.cacheCapped;
                syncFolderThumbnailsPending();
            } catch {
                // Stats are advisory; local settled counters remain the primary path.
            }
        };
        void poll();
        const timer = window.setInterval(() => void poll(), 500);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [folderThumbsLoading]);

    useEffect(() => {
        const folder = view.path;
        if (!folder || orderedImages.length === 0) {
            return;
        }
        const paths = orderedImages.map((file) => file.path);
        if (
            samePathList(indexedPathsRef.current, paths) ||
            !samePathSet(indexedPathsRef.current, paths)
        ) {
            return;
        }
        indexedPathsRef.current = paths;
        void invoke('reorder_indexing', { files: indexPayload(orderedImages) });
    }, [view.path, orderedImages]);
    const gallerySortRef = useRef(gallerySort);
    gallerySortRef.current = gallerySort;
    const viewedPathRef = useRef<string | null>(null);
    useEffect(() => {
        const path = viewedPathRef.current;
        if (!path || viewerIndexRef.current === null) {
            return;
        }
        const next = orderedImages.findIndex(
            (file) => pathKey(file.path) === pathKey(path),
        );
        if (next >= 0 && next !== viewerIndexRef.current) {
            setViewerIndex(next);
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
    }, [optimisticHiddenFolderKeys]);
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
    const commandsAvailable = commandAvailability({
        hasDirectory: view.path !== null,
        role: serviceRole,
        running: fileOperation !== null || unfavoriteBusy,
        targetCount: targetFiles.length,
    });
    const fileProgressText = showFileProgress
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

    function toggleAt(index: number) {
        const current = viewRef.current;
        const file = orderedRef.current[index];
        const countBefore = selectionRef.current.paths.length;
        if (!current.path || !file) {
            selectionDiag('toggleAt', {
                aborted: 'missing-path-or-file',
                index,
                countBefore,
            });
            return;
        }
        if (current.serviceRole === 'trash') {
            selectionDiag('toggleAt', {
                aborted: 'trash',
                index,
                path: file.path,
                countBefore,
            });
            showTrashMultiSelectToast();
            return;
        }
        const ordered = orderedRef.current.map((item) => pathKey(item.path));
        setSelectionMode(enterSelectionMode());
        setSelection((previous) => {
            const next = togglePath(
                previous,
                pathKey(current.path ?? ''),
                ordered,
                pathKey(file.path),
            );
            selectionDiag('toggleAt', {
                index,
                path: file.path,
                countBefore: previous.paths.length,
                countAfter: next.paths.length,
                selectionMode: true,
                anchor: next.anchor,
            });
            return next;
        });
    }

    function extendAt(index: number) {
        const current = viewRef.current;
        const file = orderedRef.current[index];
        const countBefore = selectionRef.current.paths.length;
        if (!current.path || !file) {
            selectionDiag('extendAt', {
                aborted: 'missing-path-or-file',
                index,
                countBefore,
            });
            return;
        }
        if (current.serviceRole === 'trash') {
            selectionDiag('extendAt', {
                aborted: 'trash',
                index,
                path: file.path,
                countBefore,
            });
            showTrashMultiSelectToast();
            return;
        }
        const ordered = orderedRef.current.map((item) => pathKey(item.path));
        setSelectionMode(enterSelectionMode());
        setSelection((previous) => {
            const next = addRange(
                previous,
                pathKey(current.path ?? ''),
                ordered,
                pathKey(file.path),
            );
            selectionDiag('extendAt', {
                index,
                path: file.path,
                countBefore: previous.paths.length,
                countAfter: next.paths.length,
                selectionMode: true,
                anchor: next.anchor,
            });
            return next;
        });
    }

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
        const silentFavorite =
            action === 'copy_to_local_favorites' && files.length === 1;
        const favoriteAddGenerations = new Map<string, number>();
        if (action === 'copy_to_local_favorites') {
            if (
                files.some((file) =>
                    isFavoriteOverlayPending(
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
        fileOperationRef.current = { id, action };
        if (!silentFavorite) {
            setFileOperation({ id, action });
            setFileProgress(null);
        }
        setFileNotice(null);
        void invoke<FileOperationResult>('run_file_operation', {
            operationId: id,
            currentDirectory: directory,
            action,
            paths: files.map((file) => file.path),
        })
            .then((result) => {
                if (
                    !viewRef.current.path ||
                    pathKey(viewRef.current.path) !== pathKey(result.directory)
                ) {
                    if (action === 'copy_to_local_favorites') {
                        setFavoriteOverlay((current) =>
                            clearFavoriteOverlayForOperation(current, id),
                        );
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
                    const marked = result.outcomes
                        .filter(
                            (item) =>
                                item.status === 'copied' ||
                                item.status === 'already_exists',
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
                    for (const item of result.outcomes) {
                        const key = pathKey(item.sourcePath);
                        const generation = favoriteAddGenerations.get(key);
                        if (generation === undefined) {
                            continue;
                        }
                        if (
                            item.status === 'copied' ||
                            item.status === 'already_exists'
                        ) {
                            setFavoriteOverlay((current) =>
                                clearFavoriteOverlayIfGeneration(
                                    current,
                                    key,
                                    generation,
                                ),
                            );
                        } else if (item.status === 'failed') {
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
                const summary = summarize(result.outcomes);
                const quietSuccess =
                    (action === 'copy_to_local_favorites' ||
                        action === 'move_to_local_trash') &&
                    summary.failed === 0;
                if (!quietSuccess) {
                    setFileNotice(operationNotice(action, summary));
                }
                if (
                    action !== 'copy_to_local_favorites' &&
                    action !== 'move_to_local_trash'
                ) {
                    scheduleFolderRefreshRef.current(directory);
                }
            })
            .catch((error: unknown) => {
                if (action === 'copy_to_local_favorites') {
                    setFavoriteOverlay((current) =>
                        clearFavoriteOverlayForOperation(current, id),
                    );
                }
                setFileNotice({
                    tone: 'failed',
                    text:
                        formatInvokeError(error),
                    details: [],
                });
            })
            .finally(() => {
                if (fileOperationRef.current?.id === id) {
                    fileOperationRef.current = null;
                }
                if (!silentFavorite) {
                    setFileOperation(null);
                    setFileProgress(null);
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
                await invoke('start_indexing', {
                    folder: next.path,
                    files: indexPayload(sorted),
                    session: id,
                });
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
        const generation = nextFavoriteOverlayGeneration(
            favoriteOverlayGenerationsRef.current,
            key,
        );
        favoriteOverlayGenerationsRef.current.set(key, generation);
        setFavoriteOverlay((current) =>
            applyFavoriteOverlayPending(
                current,
                key,
                opId,
                desired,
                generation,
            ),
        );
        return generation;
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
        for (const [key, generation] of session.copyGenerations) {
            rollbackFavoriteStarOverlay(key, generation);
        }
        session.copyGenerations.clear();
        for (const [key, generation] of session.originGenerations) {
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
        for (const [copyKey, originKey] of links) {
            session.copyToOrigin.set(copyKey, originKey);
            if (session.originGenerations.has(originKey)) {
                continue;
            }
            const generation = startFavoriteStarOverlay(
                originKey,
                false,
                sessionId,
            );
            session.originGenerations.set(originKey, generation);
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
        for (const file of targets) {
            const copyKey = pathKey(file.path);
            const generation = startFavoriteStarOverlay(
                copyKey,
                false,
                sessionId,
            );
            session.copyGenerations.set(copyKey, generation);
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

    function clearOptimisticFavoritesFolderHide(sessionId: string) {
        const hide = optimisticFavoritesFolderHideRef.current;
        if (!hide || hide.operationId !== sessionId) {
            return;
        }
        optimisticFavoritesFolderHideRef.current = null;
        setOptimisticHiddenFolderKeys(new Set());
        scheduleFolderRefreshRef.current(hide.parentDirectory);
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
            isFavoriteOverlayPending(favoriteOverlayRef.current, key)
        ) {
            return;
        }
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
        }
    }

    async function toggleFavoriteFile(file: ImageFile, confirmed = false) {
        const key = pathKey(file.path);
        if (
            inTrash ||
            busyPaths.has(key) ||
            !viewRef.current.path ||
            fileOperationRef.current ||
            lockedUnfavoritePathsRef.current.has(key) ||
            isFavoriteOverlayPending(favoriteOverlayRef.current, key)
        ) {
            return;
        }
        const active = favoriteDisplayOn(
            key,
            favoritePaths,
            favoriteOverlayRef.current,
            inFavorites,
        );
        if (!active) {
            if (viewerShowsFile(file)) {
                void copyToFavoritesFromViewer(file);
            } else {
                runFileAction('copy_to_local_favorites', [file]);
            }
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
        } else if (
            unfavoriteGateRef.current.busy &&
            !unfavoriteGateRef.current.confirmPending
        ) {
            return;
        }
        const removeOpId = operationId();
        const overlayGeneration = startFavoriteStarOverlay(
            key,
            false,
            removeOpId,
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
        beginMassUnfavoriteOriginSession(sessionId, sessionPath);
        applyInstantMassUnfavoritePresentation(sessionId, targets);
        const listingReady =
            status === 'ready' && !folderListingBusyRef.current;
        if (
            parentDirectory &&
            shouldOptimisticallyHideFavoritesServiceFolder({
                sessionPath,
                targets,
                listingImages: viewRef.current.images,
                childFolderCount: viewRef.current.folders.length,
                listingReady,
            })
        ) {
            beginOptimisticFavoritesFolderHide(
                sessionId,
                sessionPath,
                parentDirectory,
            );
            beginFolderExitAnimation(pathKey(sessionPath));
        }
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
        if (parentDirectory) {
            void loadImplRef.current(parentDirectory, true);
        }

        void (async () => {
            const readyFiles: ImageFile[] = [];
            const confirmFiles: ImageFile[] = [];
            const previewFailed: UnfavoriteBatchItemResult[] = [];
            let confirmLines: BatchUnfavoriteConfirmLine[] = [];
            try {
                const previews = await invoke<FavoriteBatchPathResult[]>(
                    'preview_remove_favorite_copies',
                    { paths: targets.map((file) => file.path) },
                );
                logUnfavoriteBatchClassifyDebug(previews);
                const byPath = new Map(
                    previews.map((entry) => [pathKey(entry.path), entry.result]),
                );
                confirmLines = batchUnfavoriteConfirmLines(targets, previews);
                for (const file of targets) {
                    const preview = byPath.get(pathKey(file.path));
                    if (!preview) {
                        rollbackMassUnfavoriteCopyOrigin(file.path);
                        previewFailed.push({
                            path: file.path,
                            status: 'failed',
                            message: 'Не удалось подготовить исключение',
                        });
                        continue;
                    }
                    if (preview.status === 'needs_confirm') {
                        rollbackMassUnfavoriteCopyOrigin(file.path);
                        confirmFiles.push(file);
                    } else if (preview.status === 'ready') {
                        readyFiles.push(file);
                    } else {
                        rollbackMassUnfavoriteCopyOrigin(file.path);
                        previewFailed.push({
                            path: file.path,
                            status: 'failed',
                            message: 'Не удалось подготовить исключение',
                        });
                    }
                }
            } catch (error: unknown) {
                rollbackAllMassUnfavoriteOrigins(sessionId);
                clearOptimisticFavoritesFolderHide(sessionId);
                releaseUnfavoriteGate();
                setFileNotice({
                    tone: 'failed',
                    text:
                        formatInvokeError(error),
                    details: [],
                });
                return;
            }

            if (confirmFiles.length > 0) {
                clearOptimisticFavoritesFolderHide(sessionId);
                unfavoriteBatchRef.current = {
                    sessionId,
                    sessionPath,
                    parentDirectory,
                    readyFiles,
                    confirmFiles,
                    priorResults: previewFailed,
                };
                setUnfavoriteGate(
                    markUnfavoriteConfirmPending(unfavoriteGateRef.current),
                );
                setUnfavoritePrompt({
                    mode: 'batch',
                    files: confirmFiles,
                    confirmLines,
                    sessionPath,
                    parentDirectory,
                });
                return;
            }

            void startBackgroundMassUnfavorite({
                sessionId,
                sessionPath,
                parentDirectory,
                work: readyFiles.map((file) => ({ file, confirmed: false })),
                priorResults: previewFailed,
            });
        })();
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
        const sessionPath = pending.sessionPath;
        const parentDirectory = pending.parentDirectory;
        const readyFiles = pending.readyFiles;
        const priorResults = pending.priorResults;
        unfavoriteBatchRef.current = null;
        for (const file of files) {
            restoreMassUnfavoriteCopyOriginOverlay(file.path, pending.sessionId);
        }
        void startBackgroundMassUnfavorite({
            sessionId: pending.sessionId,
            sessionPath,
            parentDirectory,
            work: [
                ...readyFiles.map((file) => ({ file, confirmed: false })),
                ...files.map((file) => ({ file, confirmed: true })),
            ],
            priorResults,
        });
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
        const readyFiles = pending.readyFiles;
        const sessionPath = pending.sessionPath;
        const parentDirectory = pending.parentDirectory;
        const priorResults = [...pending.priorResults, ...skipped];
        unfavoriteBatchRef.current = null;
        setUnfavoritePrompt(null);
        for (const file of files) {
            rollbackMassUnfavoriteCopyOrigin(file.path);
        }
        void startBackgroundMassUnfavorite({
            sessionId: pending.sessionId,
            sessionPath,
            parentDirectory,
            work: readyFiles.map((file) => ({ file, confirmed: false })),
            priorResults,
        });
    }
    skipBatchUnfavoriteRef.current = skipBatchUnfavorite;

    async function startBackgroundMassUnfavorite(options: {
        sessionId: string;
        sessionPath: string;
        parentDirectory: string | null;
        work: { file: ImageFile; confirmed: boolean }[];
        priorResults: UnfavoriteBatchItemResult[];
    }) {
        if (backgroundUnfavoriteRef.current) {
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
                const message =
                    formatInvokeError(error);
                for (const item of options.work) {
                    results.push({
                        path: item.file.path,
                        status: 'failed',
                        message,
                    });
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
                        favoritePathsConfirmedMutation = true;
                        setFavoritePaths((current) => {
                            const next = new Set(current);
                            next.delete(originKey);
                            return next;
                        });
                    }
                    const generation = originKey
                        ? session.originGenerations.get(originKey)
                        : undefined;
                    if (originKey && generation !== undefined) {
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
        let cleanup: UnfavoriteCleanupOutcome = pickCleanupFromResults(
            options.results,
        );

        if (
            !cleanup.navigateLocation &&
            cleanup.status !== 'not_empty' &&
            cleanup.status !== 'failed' &&
            succeeded.length > 0 &&
            options.parentDirectory
        ) {
            const fallback = await cleanupEmptyServiceFolder(
                options.parentDirectory,
                options.sessionPath,
            );
            cleanup = mergeCleanupOutcomes(cleanup, fallback);
        }

        if (cleanup.navigateLocation) {
            applyRemovedServiceFolder(cleanup.navigateLocation);
        }

        const hideOverlay = optimisticFavoritesFolderHideRef.current;
        if (hideOverlay && hideOverlay.operationId === options.sessionId) {
            if (
                cleanup.status === 'not_empty' ||
                cleanup.status === 'failed' ||
                failed.length > 0
            ) {
                clearOptimisticFavoritesFolderHide(options.sessionId);
            } else if (
                cleanup.navigateLocation ||
                cleanup.status === 'removed' ||
                cleanup.status === 'already_gone'
            ) {
                optimisticFavoritesFolderHideRef.current = null;
                setOptimisticHiddenFolderKeys(new Set());
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

        const notice = summarizeUnfavoriteBatch({
            total: options.results.length,
            succeeded: succeeded.length,
            failed: failed.length,
            skipped: skipped.length,
            cleanup,
            errors: failed.map((item) =>
                item.status === 'failed' ? item.message : '',
            ),
        });
        if (notice.tone !== 'ok') {
            setFileNotice(notice);
        }
    }

    function applyUnfavoriteResult(
        file: ImageFile,
        removal: RemoveFavoriteCopyResult,
    ) {
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
        (view.folders.length > 0 || folderExitingKey !== null);
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

    const displayFolders = useMemo(
        () =>
            orderFoldersForDisplay(view.folders).filter(
                (folder) =>
                    !optimisticHiddenFolderKeys.has(pathKey(folder.path)),
            ),
        [view.folders, optimisticHiddenFolderKeys],
    );
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
                            if (view.path) {
                                folderContext.openFolderContextMenu(
                                    event,
                                    target,
                                    view.path,
                                );
                            }
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
                    onVisible={reportVisible}
                    onGeometryRange={reportGeometry}
                    onScrollActivity={reportScrollActivity}
                    onOpen={(index) =>
                        setViewerIndex((current) =>
                            current === index ? null : index,
                        )
                    }
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
                    busy={fileOperation !== null}
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
                ['--pg-gallery-inset-pinned' as string]: `${sidebarWidth + 32}px`,
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
            {bootNotice ? (
                <p
                    className={styles.bootNotice}
                    role="status"
                >
                    {bootNotice}
                </p>
            ) : null}
            <div
                ref={galleryLayerRef}
                className={styles.galleryLayer}
            >
                {status === 'error' && (
                    <p className={styles.message}>{error}</p>
                )}
                {(status === 'scanning' &&
                    view.folders.length === 0 &&
                    view.images.length === 0) ||
                geometryPending ? (
                    <p className={styles.message}>{t('common.opening')}</p>
                ) : null}
                {status === 'ready' &&
                    view.folders.length === 0 &&
                    view.images.length === 0 &&
                    !serviceRole && (
                        <p className={styles.message}>{t('gallery.emptyFolder')}</p>
                    )}
                {status === 'ready' &&
                    view.images.length === 0 &&
                    serviceRole === 'favorites' && (
                        <p className={styles.message}>
                            {t('gallery.emptyFavorites')}
                        </p>
                    )}
                {status === 'ready' &&
                    view.images.length === 0 &&
                    serviceRole === 'trash' && (
                        <p className={styles.message}>{t('gallery.emptyTrash')}</p>
                    )}
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
                        {folderThumbsLoading ||
                        (photoGalleryActive && scrollJump.canScroll) ? (
                            <GalleryScrollJumpButton
                                pointUp={scrollJump.pointUp}
                                loading={folderThumbsLoading}
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
                            Boolean(fileProgressText),
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

