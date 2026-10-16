import { invoke } from "@tauri-apps/api/core";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { parentDirectoryPath } from "../../features/folder/lib/parentPath";
import { driveIconName } from "../../features/gallery/lib/chrome/driveIcon";
import { serviceFolderHint, serviceFolderIcon } from "../../entities/folder/serviceFolder";
import { folderDisplayName } from "../../entities/folder/folderDisplayName";
import type { DriveMedia, FolderKind, FolderShortcut } from "../../entities/folder/types";
import type { ServiceRole } from "../../entities/folder/serviceFolder";
import type { DrivesStatus } from "../../features/folder/lib/drivesState";
import { useTranslation } from "react-i18next";
import { StitchVueIcon } from "../../shared/icons/StitchVueIcon";
import type { StitchVueIconName } from "../../shared/icons/stitchvue-icons";
import { useFolderTreeScrollbarReveal } from "../../shared/hooks/useFolderTreeScrollbarReveal";
import { Tooltip } from "../../shared/ui/Tooltip";
import styles from "./FolderSidebar.module.scss";

type TreeNode = {
  name: string;
  path: string;
  kind: FolderKind;
  media?: DriveMedia | null;
  serviceRole?: "favorites" | "trash" | null;
  placeCode?: string | null;
  driveLetter?: string | null;
  driveKind?: string | null;
  expanded: boolean;
  loading: boolean;
  children: TreeNode[] | null;
};

type Row = {
  id: string;
  path: string | null;
  name: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
};

type FolderSidebarProps = {
  drives: FolderShortcut[];
  drivesStatus: DrivesStatus;
  selectedPath: string | null;
  pinned: boolean;
  peek: boolean;
  onPeek: (visible: boolean) => void;
  onTogglePin: () => void;
  onOpen: (path: string) => void;
  onHoverFolder?: (path: string, inside: boolean) => void;
  onHome: () => void;
  onRetryDrives: () => void;
  pathCopied: boolean;
  onCopyPath: () => void;
  width: number;
  onResizeWidth: (width: number) => void;
  onFolderContextMenu?: (event: MouseEvent, folder: FolderShortcut, parentDirectory: string) => void;
  hiddenFolderPathKeys?: ReadonlySet<string>;
};

export function FolderSidebar({
  drives,
  drivesStatus,
  selectedPath,
  pinned,
  peek,
  onPeek,
  onTogglePin,
  onOpen,
  onHoverFolder,
  onHome,
  onRetryDrives,
  pathCopied,
  onCopyPath,
  width,
  onResizeWidth,
  onFolderContextMenu,
  hiddenFolderPathKeys,
}: FolderSidebarProps) {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [recent, setRecent] = useState<FolderShortcut[]>([]);
  const [favorites, setFavorites] = useState<FolderShortcut[]>([]);
  const [sections, setSections] = useState({ favorites: false, recent: false, computer: true });
  const [cursor, setCursor] = useState(0);
  const rootsRef = useRef<TreeNode[]>([]);
  const revealGen = useRef(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const { onMouseMove, onMouseLeave, onPointerDown } = useFolderTreeScrollbarReveal(treeRef);

  useEffect(() => {
    const next = mergeDrives(rootsRef.current, drives);
    rootsRef.current = next;
    setRoots(next);
  }, [drives]);

  useEffect(() => {
    void refreshLists(setRecent, setFavorites);
  }, [selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    const gen = revealGen.current + 1;
    revealGen.current = gen;
    void revealPath(selectedPath, () => revealGen.current === gen, rootsRef, (next) => {
      rootsRef.current = next;
      setRoots(next);
    }, () => {
      setSections((current) => (current.computer ? current : { ...current, computer: true }));
    });
  }, [selectedPath, drives]);

  useEffect(() => {
    if (!selectedPath || !treeRef.current) {
      return;
    }
    const key = pathKey(selectedPath);
    const row = treeRef.current.querySelector(`[data-path-key="${CSS.escape(key)}"]`);
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedPath, roots]);

  useLayoutEffect(() => {
    const el = treeRef.current;
    if (!el) {
      return;
    }
    const syncViewport = () => {
      el.style.setProperty("--tree-view", `${el.clientWidth}px`);
      el.style.setProperty("--tree-scroll-x", `${el.scrollLeft}px`);
    };
    syncViewport();
    el.addEventListener("scroll", syncViewport, { passive: true });
    const observer = new ResizeObserver(syncViewport);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", syncViewport);
      observer.disconnect();
    };
  }, []);

  const treeRows = sections.computer ? visibleRows(roots, 1) : [];
  const rows: Row[] = [
    sectionRow("favorites", t("places.favorites"), sections.favorites),
    ...(sections.favorites ? favorites.map((folder) => shortcutRow(folder, "favorites")) : []),
    sectionRow("recent", t("places.recent"), sections.recent),
    ...(sections.recent ? recent.map((folder) => shortcutRow(folder, "recent")) : []),
    sectionRow("computer", t("places.thisComputer"), sections.computer),
    ...treeRows,
  ];

  function commit(next: TreeNode[]) {
    rootsRef.current = next;
    setRoots(next);
  }

  async function toggleNode(path: string) {
    const current = findNode(rootsRef.current, path);
    if (!current) {
      return;
    }
    if (current.children) {
      commit(updateNode(rootsRef.current, path, (node) => ({ ...node, expanded: !node.expanded })));
      return;
    }
    commit(updateNode(rootsRef.current, path, (node) => ({ ...node, loading: true, expanded: true })));
    try {
      const children = await invoke<FolderShortcut[]>("list_subfolders", { path });
      const latest = findNode(rootsRef.current, path);
      if (!latest) {
        return;
      }
      commit(
        updateNode(rootsRef.current, path, (node) => ({
          ...node,
          loading: false,
          expanded: true,
          children: children.map(toNode),
        })),
      );
    } catch {
      commit(updateNode(rootsRef.current, path, (node) => ({ ...node, loading: false, expanded: false })));
    }
  }

  function toggleSection(id: "favorites" | "recent" | "computer") {
    setSections((current) => ({ ...current, [id]: !current[id] }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (rows.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((index) => Math.max(0, index - 1));
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Enter") {
      const row = rows[cursor];
      if (!row) {
        return;
      }
      if (row.id === "favorites" || row.id === "recent" || row.id === "computer") {
        if (event.key === "Enter" && row.id === "computer") {
          event.preventDefault();
          onHome();
          return;
        }
        if (event.key === "Enter" || (event.key === "ArrowRight" && !row.expanded) || (event.key === "ArrowLeft" && row.expanded)) {
          event.preventDefault();
          toggleSection(row.id);
        }
        return;
      }
      if (event.key === "Enter" && row.path) {
        event.preventDefault();
        onOpen(row.path);
        return;
      }
      if (row.expandable && row.path && ((event.key === "ArrowRight" && !row.expanded) || (event.key === "ArrowLeft" && row.expanded))) {
        event.preventDefault();
        void toggleNode(row.path);
      }
    }
  }

  const shown = pinned || peek;
  const pathLabel = selectedPath ?? t("places.thisComputer");

  return (
    <aside
      className={pinned ? styles.pinned : shown ? styles.overlayOpen : styles.overlay}
      style={{ width }}
      onMouseEnter={() => onPeek(true)}
      onMouseLeave={() => onPeek(false)}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className={styles.nav}>
        <div className={styles.navButtons}>
          <Tooltip text={t("common.copyPath")}>
            <button
              type="button"
              className={styles.navButton}
              aria-label={t("common.copyPathAria")}
              aria-pressed={pathCopied}
              disabled={!selectedPath}
              onClick={onCopyPath}
            >
              <StitchVueIcon name="copy" className={styles.navGlyph} />
            </button>
          </Tooltip>
          <span className={styles.navSpacer} />
          <Tooltip text={pinned ? t("sidebar.unpinHint") : t("sidebar.pinHint")}>
            <button
              type="button"
              className={styles.navButton}
              aria-label={pinned ? t("sidebar.unpinAria") : t("sidebar.pinAria")}
              aria-pressed={pinned}
              onClick={onTogglePin}
            >
              <StitchVueIcon name={pinned ? "unpin" : "pin"} className={styles.navGlyph} />
            </button>
          </Tooltip>
        </div>
        <p className={styles.currentPath} title={pathLabel}>
          {pathLabel}
        </p>
      </div>
      <div
        className={styles.tree}
        ref={treeRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onPointerDown={onPointerDown}
      >
        <div className={styles.treeBody}>
        <Section
          id="favorites"
          title={t("places.favorites")}
          icon={<StitchVueIcon name="favorite" className={styles.sectionGlyph} />}
          expanded={sections.favorites}
          empty={t("sidebar.favoritesEmpty")}
          active={cursor === rowIndex(rows, "favorites")}
          onToggle={() => toggleSection("favorites")}
        >
          {favorites.map((folder) => (
            <Leaf
              key={folder.path}
              folder={folder}
              depth={1}
              selected={samePath(folder.path, selectedPath)}
              favorite
              active={cursor === rowIndex(rows, `favorites:${pathKey(folder.path)}`)}
              onOpen={onOpen}
              onHover={onHoverFolder}
              onFavorite={() => void star(folder, setFavorites, setRecent)}
              onFolderContextMenu={onFolderContextMenu}
            />
          ))}
        </Section>
        <Section
          id="recent"
          title={t("places.recent")}
          icon={<StitchVueIcon name="recent" className={styles.sectionGlyph} />}
          expanded={sections.recent}
          empty={t("sidebar.recentEmpty")}
          active={cursor === rowIndex(rows, "recent")}
          onToggle={() => toggleSection("recent")}
        >
          {recent.map((folder) => (
            <Leaf
              key={folder.path}
              folder={folder}
              depth={1}
              selected={samePath(folder.path, selectedPath)}
              favorite={favorites.some((item) => samePath(item.path, folder.path))}
              active={cursor === rowIndex(rows, `recent:${pathKey(folder.path)}`)}
              onOpen={onOpen}
              onHover={onHoverFolder}
              onFavorite={() => void star(folder, setFavorites, setRecent)}
              onFolderContextMenu={onFolderContextMenu}
            />
          ))}
        </Section>
        <Section
          id="computer"
          title={t("places.thisComputer")}
          icon={<StitchVueIcon name="computer" className={styles.sectionGlyph} />}
          expanded={sections.computer}
          empty={t("sidebar.computerEmpty")}
          count={roots.length}
          drivesStatus={drivesStatus}
          onRetryDrives={onRetryDrives}
          selected={selectedPath === null}
          active={cursor === rowIndex(rows, "computer")}
          onToggle={() => toggleSection("computer")}
          onActivate={onHome}
        >
          <Tree
            nodes={roots}
            depth={1}
            selectedPath={selectedPath}
            favorites={favorites}
            rows={rows}
            cursor={cursor}
            onOpen={onOpen}
            onHover={onHoverFolder}
            onToggle={(path) => void toggleNode(path)}
            onFavorite={(folder) => void star(folder, setFavorites, setRecent)}
            onFolderContextMenu={onFolderContextMenu}
            hiddenFolderPathKeys={hiddenFolderPathKeys}
          />
        </Section>
        </div>
      </div>
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={600}
        aria-valuenow={Math.round(width)}
        aria-label={t("sidebar.resizeAria")}
        onPointerDown={(event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = width;
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const move = (next: PointerEvent) => {
            onResizeWidth(startWidth + (next.clientX - startX));
          };
          const up = (next: PointerEvent) => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", up);
            if (target.hasPointerCapture(next.pointerId)) {
              target.releasePointerCapture(next.pointerId);
            }
          };
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", up);
        }}
      />
    </aside>
  );
}

function Section({
  id,
  title,
  icon,
  expanded,
  empty,
  count,
  drivesStatus,
  onRetryDrives,
  selected = false,
  active,
  onToggle,
  onActivate,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  expanded: boolean;
  empty: string;
  count?: number;
  drivesStatus?: DrivesStatus;
  onRetryDrives?: () => void;
  selected?: boolean;
  active: boolean;
  onToggle: () => void;
  onActivate?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const items = Array.isArray(children) ? children.filter(Boolean) : [];
  const hasItems = count !== undefined ? count > 0 : items.length > 0;
  return (
    <section className={styles.treeSection} data-section={id}>
      <div className={rowClass(selected, active)}>
        <button type="button" className={styles.disclosure} aria-label={expanded ? t("sidebar.collapseAria") : t("sidebar.expandAria")} onClick={onToggle}>
          <Chevron direction={expanded ? "down" : "right"} />
        </button>
        <button type="button" className={styles.open} onClick={onActivate ?? onToggle}>
          <span className={styles.sectionIcon}>{icon}</span>
          <FolderName>{title}</FolderName>
        </button>
      </div>
      {expanded ? sectionBody(hasItems, children, drivesStatus, empty, onRetryDrives, t("sidebar.computerLoading")) : null}
    </section>
  );
}

function sectionBody(
  hasItems: boolean,
  children: ReactNode,
  drivesStatus: DrivesStatus | undefined,
  empty: string,
  onRetryDrives: (() => void) | undefined,
  computerLoading: string,
): ReactNode {
  if (drivesStatus === undefined) {
    return hasItems ? children : <p className={styles.empty}>{empty}</p>;
  }
  if (hasItems) {
    return (
      <>
        {children}
        {drivesStatus === "error" ? <DrivesError onRetryDrives={onRetryDrives} /> : null}
      </>
    );
  }
  if (drivesStatus === "loading") {
    return <p className={styles.empty}>{computerLoading}</p>;
  }
  if (drivesStatus === "idle") {
    return null;
  }
  if (drivesStatus === "error") {
    return <DrivesError onRetryDrives={onRetryDrives} />;
  }
  return <p className={styles.empty}>{empty}</p>;
}

function DrivesError({ onRetryDrives }: { onRetryDrives?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.emptyBlock}>
      <p className={styles.empty}>{t("sidebar.computerLoadError")}</p>
      {onRetryDrives ? (
        <button type="button" className={styles.retryButton} onClick={onRetryDrives}>
          {t("sidebar.computerRetry")}
        </button>
      ) : null}
    </div>
  );
}

function Leaf({
  folder,
  depth,
  selected,
  favorite,
  active,
  onOpen,
  onHover,
  onFavorite,
  onFolderContextMenu,
}: {
  folder: FolderShortcut;
  depth: number;
  selected: boolean;
  favorite: boolean;
  active: boolean;
  onOpen: (path: string) => void;
  onHover?: (path: string, inside: boolean) => void;
  onFavorite: () => void;
  onFolderContextMenu?: (event: MouseEvent, folder: FolderShortcut, parentDirectory: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={rowClass(selected, active)}
      style={rowIndentStyle(depth)}
      onPointerEnter={() => onHover?.(folder.path, true)}
      onPointerLeave={() => onHover?.(folder.path, false)}
      onContextMenu={(event) => onFolderContextMenu?.(event, folder, parentDirectoryPath(folder.path))}
    >
      <span className={styles.disclosureSpacer} />
      <OpenFolderButton
        name={folderDisplayName(folder)}
        hint={serviceFolderHint(folder.serviceRole) ?? undefined}
        onClick={() => onOpen(folder.path)}
      >
        <StitchVueIcon name={treeIconName(folder.kind, folder.serviceRole, selected, folder.media)} className={styles.treeGlyph} />
      </OpenFolderButton>
      <button type="button" className={favorite ? styles.starOn : styles.star} aria-label={favorite ? t("sidebar.favoriteRemoveAria") : t("sidebar.favoriteAddAria")} onClick={onFavorite}>
        <StitchVueIcon name="favorite" className={favorite ? styles.starGlyphOn : styles.starGlyph} />
      </button>
    </div>
  );
}

function Tree({
  nodes,
  depth,
  selectedPath,
  favorites,
  rows,
  cursor,
  onOpen,
  onHover,
  onToggle,
  onFavorite,
  onFolderContextMenu,
  hiddenFolderPathKeys,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedPath: string | null;
  favorites: FolderShortcut[];
  rows: Row[];
  cursor: number;
  onOpen: (path: string) => void;
  onHover?: (path: string, inside: boolean) => void;
  onToggle: (path: string) => void;
  onFavorite: (folder: FolderShortcut) => void;
  onFolderContextMenu?: (event: MouseEvent, folder: FolderShortcut, parentDirectory: string) => void;
  hiddenFolderPathKeys?: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {nodes.map((node) => {
        if (hiddenFolderPathKeys?.has(pathKey(node.path))) {
          return null;
        }
        const selected = samePath(node.path, selectedPath);
        const favorite = favorites.some((item) => samePath(item.path, node.path));
        return (
          <div className={styles.branch} key={node.path}>
            <div
              className={rowClass(selected, cursor === rowIndex(rows, pathKey(node.path)))}
              style={rowIndentStyle(depth)}
              data-path-key={pathKey(node.path)}
              onPointerEnter={() => onHover?.(node.path, true)}
              onPointerLeave={() => onHover?.(node.path, false)}
              onContextMenu={(event) => {
                const folder: FolderShortcut = {
                  name: node.name,
                  path: node.path,
                  kind: node.kind,
                  media: (node.media as DriveMedia | null | undefined) ?? null,
                  serviceRole: (node.serviceRole as ServiceRole | null | undefined) ?? null,
                  placeCode: node.placeCode,
                  driveLetter: node.driveLetter,
                  driveKind: node.driveKind,
                };
                onFolderContextMenu?.(event, folder, parentDirectoryPath(node.path));
              }}
            >
              <button type="button" className={styles.disclosure} aria-label={node.expanded ? t("sidebar.collapseAria") : t("sidebar.expandAria")} onClick={() => onToggle(node.path)}>
                {node.loading ? <span className={styles.loading}>…</span> : <Chevron direction={node.expanded ? "down" : "right"} />}
              </button>
              <OpenFolderButton
                name={folderDisplayName(node)}
                hint={serviceFolderHint(node.serviceRole) ?? undefined}
                onClick={() => onOpen(node.path)}
              >
                <StitchVueIcon
                  name={treeIconName(node.kind, node.serviceRole, samePath(node.path, selectedPath), node.media)}
                  className={node.kind === "drive" ? styles.treeGlyphDrive : styles.treeGlyph}
                />
              </OpenFolderButton>
              <button
                type="button"
                className={favorite ? styles.starOn : styles.star}
                aria-label={favorite ? t("sidebar.favoriteRemoveAria") : t("sidebar.favoriteAddAria")}
                onClick={() => onFavorite({ name: node.name, path: node.path, kind: node.kind })}
              >
                <StitchVueIcon name="favorite" className={favorite ? styles.starGlyphOn : styles.starGlyph} />
              </button>
            </div>
            {node.expanded && node.children && (
              <Tree
                nodes={node.children}
                depth={depth + 1}
                selectedPath={selectedPath}
                favorites={favorites}
                rows={rows}
                cursor={cursor}
                onOpen={onOpen}
                onHover={onHover}
                onToggle={onToggle}
                onFavorite={onFavorite}
                onFolderContextMenu={onFolderContextMenu}
                hiddenFolderPathKeys={hiddenFolderPathKeys}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function rowIndentStyle(depth: number): CSSProperties {
  const indent = 8 + depth * 16;
  return { paddingLeft: indent, ["--row-indent" as string]: `${indent}px` };
}

function FolderName({ children }: { children: string }) {
  return (
    <span className={styles.nameSlot}>
      <span className={styles.nameSizer} aria-hidden="true">
        {children}
      </span>
      <span className={styles.name}>{children}</span>
    </span>
  );
}

function folderNameTruncated(slot: HTMLElement): boolean {
  const sizer = slot.children[0];
  const visible = slot.children[1];
  if (!(sizer instanceof HTMLElement) || !(visible instanceof HTMLElement)) {
    return false;
  }
  return sizer.scrollWidth > visible.clientWidth + 1;
}

function OpenFolderButton({
  name,
  hint,
  onClick,
  children,
}: {
  name: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const slotRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) {
      return;
    }
    const check = () => {
      setTruncated(folderNameTruncated(slot));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(slot);
    const tree = slot.closest(`.${styles.tree}`);
    if (tree instanceof HTMLElement) {
      ro.observe(tree);
    }
    tree?.addEventListener("scroll", check, { passive: true });
    const frame = window.requestAnimationFrame(check);
    return () => {
      window.cancelAnimationFrame(frame);
      ro.disconnect();
      tree?.removeEventListener("scroll", check);
    };
  }, [name]);

  return (
    <button type="button" className={styles.open} onClick={onClick}>
      <Tooltip text={hint ?? name} placement="below" enabled={truncated || Boolean(hint)}>
        <span className={styles.openLabel}>
          {children}
          <span ref={slotRef} className={styles.nameSlot}>
            <span className={styles.nameSizer} aria-hidden="true">
              {name}
            </span>
            <span className={styles.name}>{name}</span>
          </span>
        </span>
      </Tooltip>
    </button>
  );
}

function treeIconName(
  kind: FolderKind,
  role: "favorites" | "trash" | null | undefined,
  selected: boolean,
  media?: string | null,
): StitchVueIconName {
  if (kind === "drive") {
    return driveIconName(media);
  }
  return serviceFolderIcon(role) ?? (selected ? "folder-open" : "folder");
}

function Chevron({ direction }: { direction: "left" | "right" | "down" }) {
  if (direction === "down") {
    return <StitchVueIcon name="chevron-down" className={styles.chevron} />;
  }
  if (direction === "left") {
    return <StitchVueIcon name="chevron-left" className={styles.chevron} />;
  }
  return <StitchVueIcon name="chevron-right" className={styles.chevron} />;
}

function rowClass(selected: boolean, active: boolean): string {
  if (selected) {
    return styles.rowSelected;
  }
  if (active) {
    return styles.rowActive;
  }
  return styles.row;
}

function sectionRow(id: string, name: string, expanded: boolean): Row {
  return { id, path: null, name, depth: 0, expandable: true, expanded };
}

function shortcutRow(folder: FolderShortcut, section: string): Row {
  return {
    id: `${section}:${pathKey(folder.path)}`,
    path: folder.path,
    name: folderDisplayName(folder),
    depth: 1,
    expandable: false,
    expanded: false,
  };
}

function rowIndex(rows: Row[], id: string): number {
  return rows.findIndex((row) => row.id === id);
}

function toNode(folder: FolderShortcut): TreeNode {
  return { ...folder, expanded: false, loading: false, children: null };
}

function visibleRows(nodes: TreeNode[], depth: number): Row[] {
  const rows: Row[] = [];
  for (const node of nodes) {
    rows.push({
      id: pathKey(node.path),
      path: node.path,
      name: folderDisplayName(node),
      depth,
      expandable: true,
      expanded: node.expanded,
    });
    if (node.expanded && node.children) {
      rows.push(...visibleRows(node.children, depth + 1));
    }
  }
  return rows;
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  const key = pathKey(path);
  for (const node of nodes) {
    if (pathKey(node.path) === key) {
      return node;
    }
    if (node.children) {
      const nested = findNode(node.children, path);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function updateNode(nodes: TreeNode[], path: string, edit: (node: TreeNode) => TreeNode): TreeNode[] {
  const key = pathKey(path);
  return nodes.map((node) => {
    if (pathKey(node.path) === key) {
      return edit(node);
    }
    if (!node.children) {
      return node;
    }
    return { ...node, children: updateNode(node.children, path, edit) };
  });
}

function mergeDrives(current: TreeNode[], drives: FolderShortcut[]): TreeNode[] {
  return drives.map((drive) => {
    const existing = findNode(current, drive.path);
    if (!existing) {
      return toNode(drive);
    }
    return { ...existing, name: drive.name, kind: drive.kind, media: drive.media };
  });
}

function samePath(left: string, right: string | null): boolean {
  return right !== null && pathKey(left) === pathKey(right);
}

function pathKey(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function ancestorChain(path: string): string[] {
  const normalized = path.replace(/\//g, "\\").replace(/\\+$/, "");
  const match = /^([A-Za-z]:)(.*)$/.exec(normalized);
  if (!match) {
    return [normalized];
  }
  const drive = `${match[1]}\\`;
  const chain = [drive];
  let current = drive;
  for (const part of match[2].split("\\").filter(Boolean)) {
    current = `${current}${part}`;
    chain.push(current);
    current = `${current}\\`;
  }
  return chain;
}

async function revealPath(
  path: string,
  alive: () => boolean,
  rootsRef: { current: TreeNode[] },
  commit: (next: TreeNode[]) => void,
  expandComputer: () => void,
) {
  expandComputer();
  for (const segment of ancestorChain(path)) {
    if (!alive()) {
      return;
    }
    const node = findNode(rootsRef.current, segment);
    if (!node) {
      return;
    }
    if (node.children) {
      if (!node.expanded) {
        commit(updateNode(rootsRef.current, segment, (item) => ({ ...item, expanded: true })));
      }
      continue;
    }
    commit(updateNode(rootsRef.current, segment, (item) => ({ ...item, loading: true, expanded: true })));
    try {
      const children = await invoke<FolderShortcut[]>("list_subfolders", { path: node.path });
      if (!alive()) {
        return;
      }
      commit(
        updateNode(rootsRef.current, segment, (item) => ({
          ...item,
          loading: false,
          expanded: true,
          children: children.map(toNode),
        })),
      );
    } catch {
      commit(updateNode(rootsRef.current, segment, (item) => ({ ...item, loading: false, expanded: false })));
      return;
    }
  }
}

async function refreshLists(
  setRecent: (folders: FolderShortcut[]) => void,
  setFavorites: (folders: FolderShortcut[]) => void,
) {
  const [nextRecent, nextFavorites] = await Promise.all([
    invoke<FolderShortcut[]>("recent_folders"),
    invoke<FolderShortcut[]>("favorite_folders"),
  ]);
  setRecent(nextRecent);
  setFavorites(nextFavorites);
}

async function star(
  folder: FolderShortcut,
  setFavorites: (folders: FolderShortcut[]) => void,
  setRecent: (folders: FolderShortcut[]) => void,
) {
  await invoke("toggle_favorite", { path: folder.path, name: folder.name });
  await refreshLists(setRecent, setFavorites);
}

