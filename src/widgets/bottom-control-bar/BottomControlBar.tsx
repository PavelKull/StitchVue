import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from 'react';
import type { LayoutMode } from '../../entities/gallery/layoutMode';
import { LAYOUT_MODES } from '../../entities/gallery/layoutMode';
import {
    defaultSortDirection,
    type GallerySort,
    type SortKey,
} from '../../features/gallery/lib/listing/galleryOrder';
import { useTranslation } from 'react-i18next';
import { StitchVueIcon } from '../../shared/icons/StitchVueIcon';
import type { StitchVueIconName } from '../../shared/icons/stitchvue-icons';
import { Tooltip } from '../../shared/ui/Tooltip';
import styles from './BottomControlBar.module.scss';

const LAYOUT_ICONS: Record<LayoutMode, StitchVueIconName> = {
    grid: 'layout-grid',
    mosaic: 'layout-masonry',
    columns: 'layout-vertical',
};

const MORE_WIDTH = 78;

type OverflowId =
    | 'slider'
    | 'open'
    | 'sortDate'
    | 'sortName'
    | 'settings'
    | 'modes';

type BottomControlBarProps = {
    layoutMode: LayoutMode;
    zoomIndex: number;
    zoomSteps: number;
    zoomEnabled: boolean;
    appFullscreen: boolean;
    toolbarPinned: boolean;
    canBack: boolean;
    canForward: boolean;
    settingsButtonRef?: RefObject<HTMLButtonElement | null>;
    onOpenFolder: () => void;
    onBack: () => void;
    onForward: () => void;
    onLayoutMode: (mode: LayoutMode) => void;
    onZoomIndex: (index: number) => void;
    onZoomOut: () => void;
    onZoomIn: () => void;
    onToggleAppFullscreen: () => void;
    onToggleToolbarPin: () => void;
    onOpenSettings: () => void;
    sort: GallerySort;
    selectionMode: boolean;
    /** When false, hide the mass-select toggle (e.g. inside «Удаленное»). */
    selectionModeAvailable?: boolean;
    onSortKey: (key: SortKey) => void;
    onToggleSelectionMode: () => void;
    onMenuHold?: (hold: boolean) => void;
};

export function BottomControlBar({
    layoutMode,
    zoomIndex,
    zoomSteps,
    zoomEnabled,
    appFullscreen,
    toolbarPinned,
    canBack,
    canForward,
    settingsButtonRef,
    onOpenFolder,
    onBack,
    onForward,
    onLayoutMode,
    onZoomIndex,
    onZoomOut,
    onZoomIn,
    onToggleAppFullscreen,
    onToggleToolbarPin,
    onOpenSettings,
    sort,
    selectionMode,
    selectionModeAvailable = true,
    onSortKey,
    onToggleSelectionMode,
    onMenuHold,
}: BottomControlBarProps) {
    const { t } = useTranslation();
    const barRef = useRef<HTMLElement>(null);
    const moreRef = useRef<HTMLDivElement>(null);
    const widths = useRef(new Map<string, number>());
    const hiddenAt = useRef(new Map<string, number>());
    const [available, setAvailable] = useState(0);
    const [hidden, setHidden] = useState<OverflowId[]>([]);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        if (!menuOpen) {
            onMenuHold?.(false);
        }
        return () => onMenuHold?.(false);
    }, [menuOpen, onMenuHold]);
    const dateVisible = true;
    const nameVisible = true;

    function remember(id: string, node: HTMLElement | null) {
        if (node && node.offsetWidth > 0) {
            widths.current.set(id, node.offsetWidth);
        }
    }

    useLayoutEffect(() => {
        const dock = barRef.current?.closest("[data-dock='toolbar']");
        if (!(dock instanceof HTMLElement)) {
            return;
        }
        if (menuOpen) {
            dock.dataset.menu = 'open';
        } else {
            delete dock.dataset.menu;
        }
        return () => {
            delete dock.dataset.menu;
        };
    }, [menuOpen]);

    useLayoutEffect(() => {
        const parent = barRef.current?.parentElement;
        if (!parent) {
            return;
        }
        const update = () => {
            const next = parent.clientWidth;
            setAvailable((current) => (current === next ? current : next));
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(parent);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const node = barRef.current;
        const parent = node?.parentElement;
        if (!node || !parent) {
            return;
        }
        const space = parent.clientWidth;
        if (space <= 0) {
            return;
        }
        const content = node.scrollWidth;
        const order = overflowOrder(sort.key, dateVisible, nameVisible);
        if (content > space + 2) {
            const nextId = order.find((id) => !hidden.includes(id));
            if (nextId) {
                hiddenAt.current.set(nextId, space);
                setHidden((current) =>
                    current.includes(nextId) ? current : [...current, nextId],
                );
            }
            return;
        }
        if (hidden.length === 0) {
            return;
        }
        const restoreId = hidden[hidden.length - 1];
        const saved = widths.current.get(restoreId) ?? 0;
        if (saved <= 0) {
            return;
        }
        const collapsedAt = hiddenAt.current.get(restoreId);
        if (collapsedAt != null && space < collapsedAt + saved) {
            return;
        }
        const moreWidth =
            hidden.length === 1
                ? (moreRef.current?.offsetWidth ?? MORE_WIDTH)
                : 0;
        if (content - moreWidth + saved + 8 <= space) {
            hiddenAt.current.delete(restoreId);
            setHidden((current) => current.slice(0, -1));
            if (hidden.length === 1) {
                setMenuOpen(false);
            }
        }
    }, [
        available,
        hidden,
        dateVisible,
        nameVisible,
        sort.key,
        layoutMode,
        zoomSteps,
        appFullscreen,
        toolbarPinned,
        selectionMode,
        selectionModeAvailable,
        canBack,
        canForward,
    ]);

    const hide = new Set(hidden);
    const compact = hide.has('modes');
    const modesShown = !hide.has('modes');
    const sortsShown =
        (dateVisible && !hide.has('sortDate')) ||
        (nameVisible && !hide.has('sortName'));

    function pressSort(key: SortKey) {
        onSortKey(key);
    }

    return (
        <nav
            ref={barRef}
            className={styles.bar}
            data-compact={compact ? 'true' : undefined}
            data-overflow={menuOpen ? 'visible' : undefined}
            aria-label={t('toolbar.aria')}
            data-scrollbar-obstacle="bottom"
        >
            <span
                ref={(node) => remember('open', node)}
                hidden={hide.has('open') || undefined}
            >
                <ToolbarButton
                    label={t('toolbar.open')}
                    hint={t('toolbar.openHint')}
                    onClick={onOpenFolder}
                >
                    <StitchVueIcon
                        name="open-folder"
                        className={styles.icon}
                    />
                </ToolbarButton>
            </span>
            <ToolbarButton
                label={t('toolbar.back')}
                hint={t('toolbar.backHint')}
                disabled={!canBack}
                disabledHint={t('toolbar.backDisabledHint')}
                onClick={onBack}
            >
                <StitchVueIcon
                    name="navigation-back"
                    className={styles.icon}
                />
            </ToolbarButton>
            <ToolbarButton
                label={t('toolbar.forward')}
                hint={t('toolbar.forwardHint')}
                disabled={!canForward}
                disabledHint={t('toolbar.forwardDisabledHint')}
                onClick={onForward}
            >
                <StitchVueIcon
                    name="navigation-forward"
                    className={styles.icon}
                />
            </ToolbarButton>

            <span
                className={styles.divider}
                aria-hidden="true"
            />

            {modesShown ? (
                <div
                    ref={(node) => remember('modes', node)}
                    className={styles.group}
                    role="group"
                    aria-label={t('toolbar.layoutModeGroupAria')}
                >
                    {LAYOUT_MODES.map((mode) => (
                        <ToolbarButton
                            key={mode}
                            label={t(`gallery.layout.${mode}`)}
                            active={layoutMode === mode}
                            ariaLabel={t(`gallery.layout.${mode}`)}
                            hint={t(`gallery.layoutHint.${mode}`)}
                            ariaPressed={layoutMode === mode}
                            onClick={() => onLayoutMode(mode)}
                        >
                            <StitchVueIcon
                                name={LAYOUT_ICONS[mode]}
                                className={styles.icon}
                            />
                        </ToolbarButton>
                    ))}
                </div>
            ) : null}

            {modesShown ? (
                <span
                    className={styles.divider}
                    aria-hidden="true"
                />
            ) : null}

            <div
                className={styles.zoomGroup}
                role="group"
                aria-label={t('toolbar.zoomGroupAria')}
            >
                <Tooltip
                    text={
                        zoomEnabled ? t('toolbar.zoomOut') : t('toolbar.zoomDisabledHint')
                    }
                >
                    <button
                        type="button"
                        className={styles.control}
                        aria-label={t('toolbar.zoomOut')}
                        disabled={!zoomEnabled}
                        onClick={onZoomOut}
                    >
                        <StitchVueIcon
                            name="zoom-out"
                            className={styles.icon}
                        />
                    </button>
                </Tooltip>
                {hide.has('slider') ? null : (
                    <input
                        ref={(node) => remember('slider', node)}
                        className={styles.zoomSlider}
                        type="range"
                        min={0}
                        max={Math.max(0, zoomSteps - 1)}
                        value={zoomIndex}
                        aria-label={t('toolbar.zoomGroupAria')}
                        disabled={!zoomEnabled}
                        style={
                            {
                                '--zoom-fill': `${(zoomIndex / Math.max(1, zoomSteps - 1)) * 100}%`,
                            } as CSSProperties
                        }
                        onChange={(event) =>
                            onZoomIndex(Number(event.target.value))
                        }
                    />
                )}
                <Tooltip
                    text={
                        zoomEnabled ? t('toolbar.zoomIn') : t('toolbar.zoomDisabledHint')
                    }
                >
                    <button
                        type="button"
                        className={styles.control}
                        aria-label={t('toolbar.zoomIn')}
                        disabled={!zoomEnabled}
                        onClick={onZoomIn}
                    >
                        <StitchVueIcon
                            name="zoom-in"
                            className={styles.icon}
                        />
                    </button>
                </Tooltip>
            </div>

            {sortsShown ? (
                <span
                    className={styles.divider}
                    aria-hidden="true"
                />
            ) : null}

            {sortsShown ? (
                <div
                    className={styles.group}
                    role="group"
                    aria-label={t('toolbar.sortGroupAria')}
                >
                    {dateVisible && !hide.has('sortDate') ? (
                        <span ref={(node) => remember('sortDate', node)}>
                            <SortButton
                                sort={sort}
                                sortKey="date"
                                label={t('toolbar.sortDate')}
                                hint={t('toolbar.sortDateHint')}
                                icon="recent"
                                onPress={pressSort}
                            />
                        </span>
                    ) : null}
                    {nameVisible && !hide.has('sortName') ? (
                        <span ref={(node) => remember('sortName', node)}>
                            <SortButton
                                sort={sort}
                                sortKey="name"
                                label={t('toolbar.sortName')}
                                hint={t('toolbar.sortNameHint')}
                                icon="file-document"
                                onPress={pressSort}
                            />
                        </span>
                    ) : null}
                </div>
            ) : null}

            <span
                className={styles.divider}
                aria-hidden="true"
            />

            {selectionModeAvailable ? (
                <ToolbarButton
                    label={t('toolbar.select')}
                    hint={
                        selectionMode
                            ? t('toolbar.selectOnHint')
                            : t('toolbar.selectOffHint')
                    }
                    active={selectionMode}
                    ariaPressed={selectionMode}
                    onClick={onToggleSelectionMode}
                >
                    <StitchVueIcon
                        name="file-image"
                        className={styles.icon}
                    />
                </ToolbarButton>
            ) : null}
            <ToolbarButton
                label={
                    appFullscreen
                        ? t('toolbar.fullscreenExitAria')
                        : t('toolbar.fullscreenEnterAria')
                }
                active={appFullscreen}
                hint={
                    appFullscreen
                        ? t('toolbar.fullscreenExitHint')
                        : t('toolbar.fullscreenEnterHint')
                }
                ariaLabel={
                    appFullscreen
                        ? t('toolbar.fullscreenExitAria')
                        : t('toolbar.fullscreenEnterAria')
                }
                ariaPressed={appFullscreen}
                onClick={onToggleAppFullscreen}
            >
                <StitchVueIcon
                    name={
                        appFullscreen ? 'fullscreen-exit' : 'fullscreen-enter'
                    }
                    className={styles.icon}
                />
            </ToolbarButton>
            {hide.has('settings') ? null : (
                <span ref={(node) => remember('settings', node)}>
                    <ToolbarButton
                        buttonRef={settingsButtonRef}
                        label={t('toolbar.settings')}
                        hint={t('toolbar.settingsHint')}
                        ariaLabel={t('toolbar.settings')}
                        onClick={onOpenSettings}
                    >
                        <StitchVueIcon
                            name="settings"
                            className={styles.icon}
                        />
                    </ToolbarButton>
                </span>
            )}
            <ToolbarButton
                label={toolbarPinned ? t('toolbar.unpinPanel') : t('toolbar.pinPanel')}
                hint={toolbarPinned ? t('toolbar.unpinHint') : t('toolbar.pinHint')}
                ariaLabel={toolbarPinned ? t('toolbar.unpinAria') : t('toolbar.pinAria')}
                ariaPressed={toolbarPinned}
                active={toolbarPinned}
                onClick={onToggleToolbarPin}
            >
                <StitchVueIcon
                    name={
                        toolbarPinned
                            ? 'panel-hide-bottom'
                            : 'panel-show-bottom'
                    }
                    className={styles.icon}
                />
            </ToolbarButton>

            {hidden.length > 0 ? (
                <div
                    ref={moreRef}
                    className={styles.more}
                    onMouseLeave={() => setMenuOpen(false)}
                >
                    <ToolbarButton
                        label={t('toolbar.more')}
                        hint={t('toolbar.moreHint')}
                        ariaExpanded={menuOpen}
                        onClick={() => setMenuOpen((value) => !value)}
                    >
                        <StitchVueIcon
                            name="navigation-more"
                            className={styles.icon}
                        />
                    </ToolbarButton>
                    {menuOpen ? (
                        <div
                            className={styles.menu}
                            role="menu"
                            onMouseEnter={() => onMenuHold?.(true)}
                            onMouseLeave={() => onMenuHold?.(false)}
                        >
                            {hide.has('open') ? (
                                <MenuButton
                                    icon="open-folder"
                                    label={t('toolbar.open')}
                                    onClick={onOpenFolder}
                                />
                            ) : null}
                            {hide.has('modes')
                                ? LAYOUT_MODES.map((mode) => (
                                      <MenuButton
                                          key={mode}
                                          icon={LAYOUT_ICONS[mode]}
                                          label={t(`gallery.layout.${mode}`)}
                                          active={layoutMode === mode}
                                          onClick={() => onLayoutMode(mode)}
                                      />
                                  ))
                                : null}
                            {dateVisible && hide.has('sortDate') ? (
                                <MenuButton
                                    icon="recent"
                                    label={
                                        sort.key === 'date'
                                            ? `${t('toolbar.sortDate')} ${sort.direction === 'asc' ? '↑' : '↓'}`
                                            : t('toolbar.sortDate')
                                    }
                                    active={sort.key === 'date'}
                                    onClick={() => pressSort('date')}
                                />
                            ) : null}
                            {nameVisible && hide.has('sortName') ? (
                                <MenuButton
                                    icon="file-document"
                                    label={
                                        sort.key === 'name'
                                            ? `${t('toolbar.sortName')} ${sort.direction === 'asc' ? '↑' : '↓'}`
                                            : t('toolbar.sortName')
                                    }
                                    active={sort.key === 'name'}
                                    onClick={() => pressSort('name')}
                                />
                            ) : null}
                            {hide.has('settings') ? (
                                <MenuButton
                                    icon="settings"
                                    label={t('toolbar.settings')}
                                    onClick={onOpenSettings}
                                />
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </nav>
    );
}

function SortButton({
    sort,
    sortKey,
    label,
    hint,
    icon,
    onPress,
}: {
    sort: GallerySort;
    sortKey: SortKey;
    label: string;
    hint: string;
    icon: StitchVueIconName;
    onPress: (key: SortKey) => void;
}) {
    const { t } = useTranslation();
    const active = sort.key === sortKey;
    const hintText = !active
        ? hint
        : sort.direction === defaultSortDirection(sortKey)
          ? t('toolbar.sortRepeatDirection', { hint })
          : t('toolbar.sortRepeatOff', { hint });
    return (
        <ToolbarButton
            label={label}
            hint={hintText}
            active={active}
            ariaPressed={active}
            onClick={() => onPress(sortKey)}
        >
            <span className={styles.sortIcon}>
                <StitchVueIcon
                    name={icon}
                    className={styles.icon}
                />
                {active ? (
                    <StitchVueIcon
                        name={
                            sort.direction === 'asc'
                                ? 'chevron-up'
                                : 'chevron-down'
                        }
                        className={styles.sortArrow}
                    />
                ) : null}
            </span>
        </ToolbarButton>
    );
}

function overflowOrder(
    active: SortKey | null,
    dateVisible: boolean,
    nameVisible: boolean,
): OverflowId[] {
    const order: OverflowId[] = ['slider', 'open'];
    if (active === 'date') {
        if (nameVisible) order.push('sortName');
        if (dateVisible) order.push('sortDate');
    } else {
        if (dateVisible) order.push('sortDate');
        if (nameVisible) order.push('sortName');
    }
    order.push('settings', 'modes');
    return order;
}

function ToolbarButton({
    label,
    children,
    active,
    disabled,
    ariaLabel,
    ariaPressed,
    ariaExpanded,
    hint,
    disabledHint,
    buttonRef,
    onClick,
}: {
    label: string;
    children: ReactNode;
    active?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    ariaPressed?: boolean;
    ariaExpanded?: boolean;
    hint?: string;
    disabledHint?: string;
    buttonRef?: RefObject<HTMLButtonElement | null>;
    onClick: () => void;
}) {
    return (
        <Tooltip
            text={
                disabled && disabledHint
                    ? disabledHint
                    : (hint ?? ariaLabel ?? label)
            }
        >
            <button
                ref={buttonRef}
                type="button"
                className={active ? styles.controlActive : styles.control}
                aria-label={ariaLabel ?? label}
                aria-pressed={ariaPressed}
                aria-expanded={ariaExpanded}
                disabled={disabled}
                onClick={onClick}
            >
                {children}
                <span className={styles.controlLabel}>{label}</span>
            </button>
        </Tooltip>
    );
}

function MenuButton({
    icon,
    label,
    active,
    onClick,
}: {
    icon: StitchVueIconName;
    label: string;
    active?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            className={active ? styles.menuItemActive : styles.menuItem}
            role="menuitem"
            onClick={onClick}
        >
            <StitchVueIcon
                name={icon}
                className={styles.menuIcon}
            />
            {label}
        </button>
    );
}
