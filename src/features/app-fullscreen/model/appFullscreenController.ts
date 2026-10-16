import { measureFullscreenBottomInset } from "../lib/appFullscreenWindow.ts";
import {
  createTauriFullscreenBridge,
  type FullscreenWindowBridge,
} from "../lib/appFullscreenBridge.ts";
import {
  fsDiagBegin,
  fsDiagEnd,
  fsDiagMark,
} from "../lib/appFullscreenDiag.ts";
import {
  readPrefersReducedMotion,
  resolvePanelMotionMs,
} from "../lib/appFullscreenMotion.ts";
import { waitForWindowSettle, type SettleSignal } from "../lib/waitForWindowSettle.ts";

export type FullscreenPhase = "idle" | "preparing" | "switching" | "settling";

export type AppFullscreenSnapshot = {
  enabled: boolean;
  phase: FullscreenPhase;
  /** Target while a transition is running; null when idle. */
  target: boolean | null;
  bottomInset: number;
  generation: number;
};

type Listener = () => void;

export type AppFullscreenControllerOptions = {
  bridge?: FullscreenWindowBridge;
  getAnimationsEnabled?: () => boolean;
  wait?: typeof waitForWindowSettle;
  measureInset?: typeof measureFullscreenBottomInset;
  delay?: (ms: number, signal: SettleSignal) => Promise<void>;
  prepareFrame?: (signal: SettleSignal) => Promise<void>;
};

function defaultDelay(ms: number, signal: SettleSignal): Promise<void> {
  if (ms <= 0 || signal.cancelled) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const id = window.setTimeout(() => resolve(), ms);
    const poll = window.setInterval(() => {
      if (signal.cancelled) {
        window.clearTimeout(id);
        window.clearInterval(poll);
        resolve();
      }
    }, 16);
    window.setTimeout(() => window.clearInterval(poll), ms + 32);
  });
}

/** Two frames so React can commit freeze/panel styles before the OS call. */
function defaultPrepareFrame(signal: SettleSignal): Promise<void> {
  if (signal.cancelled || typeof requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (signal.cancelled) {
        resolve();
        return;
      }
      requestAnimationFrame(() => resolve());
    });
  });
}

export class AppFullscreenController {
  private snapshot: AppFullscreenSnapshot = {
    enabled: false,
    phase: "idle",
    target: null,
    bottomInset: 0,
    generation: 0,
  };
  private readonly listeners = new Set<Listener>();
  private readonly bridge: FullscreenWindowBridge;
  private readonly wait: typeof waitForWindowSettle;
  private readonly measureInset: typeof measureFullscreenBottomInset;
  private readonly delay: (ms: number, signal: SettleSignal) => Promise<void>;
  private readonly prepareFrame: (signal: SettleSignal) => Promise<void>;
  private getAnimationsEnabled: () => boolean;
  private runId = 0;
  private pendingTarget: boolean | null = null;
  private unlistenResize: (() => void) | null = null;
  private startCount = 0;
  private heightBeforeEnter = 0;

  constructor(options: AppFullscreenControllerOptions = {}) {
    this.bridge = options.bridge ?? createTauriFullscreenBridge();
    this.wait = options.wait ?? waitForWindowSettle;
    this.measureInset = options.measureInset ?? measureFullscreenBottomInset;
    this.delay = options.delay ?? defaultDelay;
    this.prepareFrame = options.prepareFrame ?? defaultPrepareFrame;
    this.getAnimationsEnabled = options.getAnimationsEnabled ?? (() => true);
  }

  getSnapshot = (): AppFullscreenSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setAnimationsEnabledGetter(getter: () => boolean): void {
    this.getAnimationsEnabled = getter;
  }

  /** Ref-counted OS sync + resize listener. */
  async start(): Promise<() => void> {
    this.startCount += 1;
    if (this.startCount === 1) {
      await this.syncFromOs();
      this.unlistenResize = await this.bridge.onResized(() => {
        if (this.snapshot.phase !== "idle") {
          return;
        }
        void this.syncFromOs();
      });
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.startCount = Math.max(0, this.startCount - 1);
      if (this.startCount === 0) {
        this.unlistenResize?.();
        this.unlistenResize = null;
        this.runId += 1;
        this.pendingTarget = null;
      }
    };
  }

  async toggle(): Promise<void> {
    const next =
      this.snapshot.phase === "idle"
        ? !this.snapshot.enabled
        : !(this.snapshot.target ?? this.snapshot.enabled);
    await this.setEnabled(next);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.snapshot.phase !== "idle") {
      this.pendingTarget = enabled;
      return;
    }
    if (this.snapshot.enabled === enabled) {
      this.pendingTarget = null;
      return;
    }
    await this.runTransition(enabled);
  }

  private panelMs(): number {
    return resolvePanelMotionMs(
      this.getAnimationsEnabled(),
      readPrefersReducedMotion(),
    );
  }

  private async runTransition(enabled: boolean): Promise<void> {
    const runId = ++this.runId;
    const signal: SettleSignal = { cancelled: false };
    const cancelIfStale = () => {
      if (runId !== this.runId) {
        signal.cancelled = true;
        return true;
      }
      return false;
    };

    const diagLabel = enabled ? "enter-fullscreen" : "exit-fullscreen";
    fsDiagBegin(diagLabel);

    this.patch({
      phase: "preparing",
      target: enabled,
      generation: this.snapshot.generation + 1,
    });
    fsDiagMark("phase:preparing");

    if (enabled) {
      this.heightBeforeEnter = this.bridge.innerSize().height;
    }

    // Commit preparing UI (panel hide + layout freeze), then call OS without a long wait.
    await this.prepareFrame(signal);
    fsDiagMark("prepareFrame:done");
    if (cancelIfStale()) {
      fsDiagEnd(diagLabel);
      return;
    }

    this.patch({ phase: "switching" });
    fsDiagMark("phase:switching:before-os");

    try {
      await this.bridge.setFullscreen(enabled);
      fsDiagMark("os:setFullscreen:resolved");
    } catch {
      fsDiagMark("os:setFullscreen:error");
      await this.recoverAfterError(runId);
      fsDiagEnd(diagLabel);
      return;
    }
    if (cancelIfStale()) {
      fsDiagEnd(diagLabel);
      return;
    }

    await this.wait(this.bridge, enabled, signal);
    fsDiagMark("waitForWindowSettle:done");
    if (cancelIfStale()) {
      fsDiagEnd(diagLabel);
      return;
    }

    let bottomInset = 0;
    if (enabled) {
      bottomInset = this.measureInset(this.heightBeforeEnter);
    }

    this.patch({
      phase: "settling",
      enabled,
      bottomInset,
    });
    fsDiagMark("phase:settling", { bottomInset });

    await this.delay(Math.min(this.panelMs(), 120), signal);
    if (cancelIfStale()) {
      fsDiagEnd(diagLabel);
      return;
    }

    let osEnabled = enabled;
    try {
      osEnabled = await this.bridge.isFullscreen();
    } catch {
      osEnabled = enabled;
    }
    if (cancelIfStale()) {
      fsDiagEnd(diagLabel);
      return;
    }

    this.patch({
      phase: "idle",
      enabled: osEnabled,
      target: null,
      bottomInset: osEnabled ? this.snapshot.bottomInset : 0,
    });
    fsDiagMark("phase:idle");
    fsDiagEnd(diagLabel);

    const queued = this.pendingTarget;
    this.pendingTarget = null;
    if (queued !== null && queued !== this.snapshot.enabled) {
      await this.runTransition(queued);
    }
  }

  private async recoverAfterError(runId: number): Promise<void> {
    if (runId !== this.runId) {
      return;
    }
    let osEnabled = this.snapshot.enabled;
    try {
      osEnabled = await this.bridge.isFullscreen();
    } catch {
      // keep previous
    }
    this.patch({
      phase: "idle",
      enabled: osEnabled,
      target: null,
      bottomInset: osEnabled ? this.snapshot.bottomInset : 0,
    });
    const queued = this.pendingTarget;
    this.pendingTarget = null;
    if (queued !== null && queued !== this.snapshot.enabled) {
      await this.runTransition(queued);
    }
  }

  private async syncFromOs(): Promise<void> {
    if (this.snapshot.phase !== "idle") {
      return;
    }
    try {
      const fs = await this.bridge.isFullscreen();
      if (fs === this.snapshot.enabled) {
        return;
      }
      this.patch({
        enabled: fs,
        bottomInset: fs ? this.snapshot.bottomInset : 0,
        target: null,
      });
    } catch {
      // ignore transient bridge errors
    }
  }

  private patch(partial: Partial<AppFullscreenSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

let shared: AppFullscreenController | null = null;

export function getAppFullscreenController(): AppFullscreenController {
  if (!shared) {
    shared = new AppFullscreenController();
  }
  return shared;
}

/** Test-only: replace the shared controller. */
export function resetAppFullscreenControllerForTests(
  controller?: AppFullscreenController | null,
): void {
  shared = controller ?? null;
}
