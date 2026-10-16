/** DEV-only selection diagnostics for WebView2. Stripped from production by `import.meta.env.DEV`. */

export type SelectionDiagEvent = {
  t: number;
  kind: string;
  detail: Record<string, unknown>;
};

const MAX = 200;
const buffer: SelectionDiagEvent[] = [];
const listeners = new Set<() => void>();

declare global {
  interface Window {
    __SV_SEL_DIAG__?: {
      dump: () => SelectionDiagEvent[];
      clear: () => void;
      text: () => string;
    };
  }
}

/** Off by default. Opt in only while debugging: `localStorage.setItem("sv-sel-diag","1")` then reload. */
export function selectionDiagEnabled(): boolean {
  if (import.meta.env.DEV !== true || typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem("sv-sel-diag") === "1";
  } catch {
    return false;
  }
}

function describeNode(node: EventTarget | null): string {
  if (!(node instanceof Element)) {
    return node === null ? "null" : Object.prototype.toString.call(node);
  }
  const id = node.id ? `#${node.id}` : "";
  const cls =
    typeof node.className === "string" && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).slice(0, 4).join(".")}`
      : "";
  const photo = node.closest("[data-photo-key]");
  const photoKey = photo instanceof HTMLElement ? photo.dataset.photoKey ?? "" : "";
  const role =
    node.getAttribute("aria-label")?.slice(0, 40) ??
    node.getAttribute("data-gallery-viewport") ??
    "";
  return `${node.tagName.toLowerCase()}${id}${cls}${photoKey ? ` photo=${photoKey}` : ""}${role ? ` «${role}»` : ""}`;
}

export function layerUnderPoint(x: number, y: number): string {
  if (typeof document === "undefined") {
    return "n/a";
  }
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof Element)) {
    return "none";
  }
  const layered = el.closest("[data-sv-layer]");
  if (layered instanceof HTMLElement && layered.dataset.svLayer) {
    return `${layered.dataset.svLayer}:${describeNode(el)}`;
  }
  if (el.closest("[data-gallery-scrollbar]")) {
    return "scrollbar";
  }
  if (el.closest("[data-photo-key]")) {
    return `photo-chrome:${describeNode(el)}`;
  }
  if (el.closest("[data-gallery-viewport]")) {
    return `viewport:${describeNode(el)}`;
  }
  return describeNode(el);
}

export function selectionDiag(kind: string, detail: Record<string, unknown> = {}): void {
  if (!selectionDiagEnabled()) {
    return;
  }
  const entry: SelectionDiagEvent = { t: performance.now(), kind, detail };
  buffer.push(entry);
  if (buffer.length > MAX) {
    buffer.splice(0, buffer.length - MAX);
  }
  // eslint-disable-next-line no-console
  console.info(`[sv-sel-diag] ${kind}`, detail);
  for (const listener of listeners) {
    listener();
  }
}

export function selectionDiagPointer(
  phase: "pointerdown" | "mousedown" | "mouseup" | "click",
  event: {
    target: EventTarget | null;
    currentTarget: EventTarget | null;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    defaultPrevented: boolean;
    button?: number;
    clientX?: number;
    clientY?: number;
  },
  extra: Record<string, unknown> = {},
): void {
  if (!selectionDiagEnabled()) {
    return;
  }
  const x = event.clientX ?? 0;
  const y = event.clientY ?? 0;
  selectionDiag(phase, {
    target: describeNode(event.target),
    currentTarget: describeNode(event.currentTarget),
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    defaultPrevented: event.defaultPrevented,
    button: event.button ?? null,
    layerAtPoint: typeof event.clientX === "number" ? layerUnderPoint(x, y) : null,
    ...extra,
  });
}

export function selectionDiagKey(
  event: {
    key: string;
    code?: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    defaultPrevented: boolean;
    target: EventTarget | null;
  },
  extra: Record<string, unknown> = {},
): void {
  if (!selectionDiagEnabled()) {
    return;
  }
  selectionDiag("keydown", {
    key: event.key,
    code: event.code ?? null,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    defaultPrevented: event.defaultPrevented,
    target: describeNode(event.target),
    ...extra,
  });
}

let gestureSeq = 0;
let activeGesture: { id: number; toggles: number; extends: number; startedAt: number } | null = null;

export function selectionDiagBeginGesture(reason: string): number {
  if (!selectionDiagEnabled()) {
    return 0;
  }
  gestureSeq += 1;
  activeGesture = { id: gestureSeq, toggles: 0, extends: 0, startedAt: performance.now() };
  selectionDiag("gesture-begin", { gestureId: activeGesture.id, reason });
  return activeGesture.id;
}

export function selectionDiagNoteHandler(
  handler: "onToggleSelect" | "onExtendSelect",
  info: { gestureId?: number; path?: string; index?: number; selectionMode?: boolean; countBefore?: number },
): void {
  if (!selectionDiagEnabled()) {
    return;
  }
  if (activeGesture && (info.gestureId === undefined || info.gestureId === activeGesture.id)) {
    if (handler === "onToggleSelect") {
      activeGesture.toggles += 1;
    } else {
      activeGesture.extends += 1;
    }
  }
  selectionDiag(handler, {
    ...info,
    gestureToggles: activeGesture?.toggles ?? null,
    gestureExtends: activeGesture?.extends ?? null,
  });
}

export function selectionDiagEndGesture(extra: Record<string, unknown> = {}): void {
  if (!selectionDiagEnabled() || !activeGesture) {
    return;
  }
  const g = activeGesture;
  selectionDiag("gesture-end", {
    gestureId: g.id,
    toggles: g.toggles,
    extends: g.extends,
    doubleToggleRisk: g.toggles > 1,
    elapsedMs: performance.now() - g.startedAt,
    ...extra,
  });
  activeGesture = null;
}

export function selectionDiagSelectStart(attached: boolean, fired = false): void {
  selectionDiag(fired ? "selectstart-fired" : "selectstart-listener", { attached, fired });
}

export function getSelectionDiagDump(): SelectionDiagEvent[] {
  return [...buffer];
}

export function clearSelectionDiag(): void {
  buffer.length = 0;
  for (const listener of listeners) {
    listener();
  }
}

export function selectionDiagText(): string {
  return buffer
    .map((entry) => {
      const ms = entry.t.toFixed(1);
      return `${ms} ${entry.kind} ${JSON.stringify(entry.detail)}`;
    })
    .join("\n");
}

export function subscribeSelectionDiag(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function installSelectionDiagGlobals(): void {
  if (!selectionDiagEnabled() || typeof window === "undefined") {
    return;
  }
  window.__SV_SEL_DIAG__ = {
    dump: getSelectionDiagDump,
    clear: clearSelectionDiag,
    text: selectionDiagText,
  };
  selectionDiag("diag-ready", { note: "window.__SV_SEL_DIAG__.text() / dump() / clear()" });
}
