import assert from "node:assert/strict";
import test from "node:test";
import {
  AppFullscreenController,
  type AppFullscreenSnapshot,
} from "./appFullscreenController.ts";
import type { FullscreenWindowBridge } from "./appFullscreenBridge.ts";
import type { SettleSignal } from "./waitForWindowSettle.ts";

function createMockBridge(initial = false): FullscreenWindowBridge & {
  fullscreen: boolean;
  resizeHandlers: Array<() => void>;
  failNextSet: boolean;
} {
  const bridge = {
    fullscreen: initial,
    resizeHandlers: [] as Array<() => void>,
    failNextSet: false,
    async setFullscreen(enabled: boolean) {
      if (bridge.failNextSet) {
        bridge.failNextSet = false;
        throw new Error("setFullscreen failed");
      }
      bridge.fullscreen = enabled;
      for (const handler of bridge.resizeHandlers) {
        handler();
      }
    },
    async isFullscreen() {
      return bridge.fullscreen;
    },
    async onResized(handler: () => void) {
      bridge.resizeHandlers.push(handler);
      return () => {
        bridge.resizeHandlers = bridge.resizeHandlers.filter((h) => h !== handler);
      };
    },
    innerSize() {
      return {
        width: 1600,
        height: bridge.fullscreen ? 1080 : 1000,
      };
    },
  };
  return bridge;
}

async function waitFor(
  get: () => AppFullscreenSnapshot,
  predicate: (snap: AppFullscreenSnapshot) => boolean,
  label: string,
): Promise<AppFullscreenSnapshot> {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const snap = get();
    if (predicate(snap)) {
      return snap;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(get())}`);
}

function createController(bridge: FullscreenWindowBridge) {
  return new AppFullscreenController({
    bridge,
    getAnimationsEnabled: () => false,
    delay: async () => undefined,
    prepareFrame: async () => undefined,
    wait: async (_bridge, _expect, _signal: SettleSignal) =>
      _bridge.innerSize(),
    measureInset: (before) => Math.max(0, 1080 - before),
  });
}

test("enter and exit reach idle with matching enabled flag", async () => {
  const bridge = createMockBridge(false);
  const controller = createController(bridge);
  const stop = await controller.start();

  await controller.setEnabled(true);
  const entered = await waitFor(
    controller.getSnapshot,
    (s) => s.phase === "idle" && s.enabled,
    "enter idle",
  );
  assert.equal(entered.bottomInset, 80);
  assert.equal(bridge.fullscreen, true);

  await controller.setEnabled(false);
  const exited = await waitFor(
    controller.getSnapshot,
    (s) => s.phase === "idle" && !s.enabled,
    "exit idle",
  );
  assert.equal(exited.bottomInset, 0);
  assert.equal(bridge.fullscreen, false);

  stop();
});

test("rapid toggles queue the latest target", async () => {
  const bridge = createMockBridge(false);
  const controller = createController(bridge);
  await controller.start();

  const first = controller.setEnabled(true);
  void controller.setEnabled(false);
  void controller.setEnabled(true);
  await first;
  const snap = await waitFor(
    controller.getSnapshot,
    (s) => s.phase === "idle",
    "queued idle",
  );
  assert.equal(snap.enabled, true);
  assert.equal(bridge.fullscreen, true);
});

test("Tauri error leaves idle synced to OS", async () => {
  const bridge = createMockBridge(false);
  bridge.failNextSet = true;
  const controller = createController(bridge);
  await controller.start();

  await controller.setEnabled(true);
  const snap = await waitFor(
    controller.getSnapshot,
    (s) => s.phase === "idle",
    "error idle",
  );
  assert.equal(snap.enabled, false);
  assert.equal(snap.target, null);
});

test("OS resize sync updates enabled while idle", async () => {
  const bridge = createMockBridge(false);
  const controller = createController(bridge);
  await controller.start();

  bridge.fullscreen = true;
  for (const handler of bridge.resizeHandlers) {
    handler();
  }
  const snap = await waitFor(
    controller.getSnapshot,
    (s) => s.enabled === true,
    "os sync",
  );
  assert.equal(snap.phase, "idle");
});
