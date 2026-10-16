import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addCalendarMonths,
  canShowSupportReminderNow,
  completeMilestone,
  getPendingMilestone,
  milestonesCompletedByShowing,
} from "./supportReminderLogic.ts";
import type { SupportReminderState } from "./supportReminderTypes.ts";
import {
  dismissSupportReminder,
  loadSupportReminderState,
  normalizeSupportReminderState,
  permanentlyDismissSupportReminders,
  persistenceBlockedThisSession,
  readPendingMilestone,
  recordAppLaunch,
  resetSupportReminderPersistenceFlags,
  saveSupportReminderState,
} from "./supportReminderState.ts";
import { SUPPORT_REMINDER_SESSION_BOOT_KEY, SUPPORT_REMINDER_STORAGE_KEY } from "./supportReminderTypes.ts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
  };
}

function baseState(overrides: Partial<SupportReminderState> = {}): SupportReminderState {
  return {
    launchCount: 0,
    firstLaunchAt: "2024-01-01T12:00:00.000Z",
    lastShownAt: null,
    shownMilestones: [],
    neverShowAgain: false,
    ...overrides,
  };
}

function d(iso: string): Date {
  return new Date(iso);
}

describe("supportReminderLogic", () => {
  it("shows no milestone for launches 1–4", () => {
    for (let launch = 1; launch <= 4; launch += 1) {
      const state = baseState({ launchCount: launch });
      assert.equal(getPendingMilestone(state, d("2024-01-10T12:00:00.000Z")), null);
    }
  });

  it("blocks launch5 before 3 days since first launch", () => {
    const state = baseState({ launchCount: 5 });
    assert.equal(getPendingMilestone(state, d("2024-01-03T11:00:00.000Z")), null);
  });

  it("allows launch5 at 5+ launches and 3+ days", () => {
    const state = baseState({ launchCount: 5 });
    assert.equal(getPendingMilestone(state, d("2024-01-04T12:00:00.000Z")), "launch5");
  });

  it("does not repeat launch5 after it was shown", () => {
    const state = baseState({
      launchCount: 6,
      shownMilestones: ["launch5"],
      lastShownAt: "2024-01-04T12:00:00.000Z",
    });
    assert.equal(getPendingMilestone(state, d("2024-01-20T12:00:00.000Z")), null);
  });

  it("allows launch20 when constraints are met", () => {
    const state = baseState({
      launchCount: 20,
      shownMilestones: ["launch5"],
      lastShownAt: "2024-01-04T12:00:00.000Z",
    });
    assert.equal(getPendingMilestone(state, d("2024-01-20T12:00:00.000Z")), "launch20");
  });

  it("allows month3 regardless of launch count", () => {
    const state = baseState({
      launchCount: 1,
      firstLaunchAt: "2024-01-31T12:00:00.000Z",
    });
    const due = addCalendarMonths(d("2024-01-31T12:00:00.000Z"), 3);
    assert.equal(getPendingMilestone(state, due), "month3");
  });

  it("handles calendar months across year boundary", () => {
    const first = d("2023-11-15T08:00:00.000Z");
    const due = addCalendarMonths(first, 3);
    assert.equal(due.getFullYear(), 2024);
    assert.equal(due.getMonth(), 1);
    const state = baseState({ firstLaunchAt: first.toISOString(), launchCount: 2 });
    assert.equal(getPendingMilestone(state, due), "month3");
  });

  it("clamps end-of-month when adding calendar months", () => {
    const jan31 = new Date(2024, 0, 31, 12, 0, 0);
    const plusOne = addCalendarMonths(jan31, 1);
    assert.equal(plusOne.getFullYear(), 2024);
    assert.equal(plusOne.getMonth(), 1);
    assert.equal(plusOne.getDate(), 29);
    const plusThree = addCalendarMonths(jan31, 3);
    assert.equal(plusThree.getMonth(), 3);
    assert.equal(plusThree.getDate(), 30);
  });

  it("handles Feb 29 leap year + 3 calendar months", () => {
    const feb29 = new Date(2024, 1, 29, 15, 30, 0);
    const due = addCalendarMonths(feb29, 3);
    assert.equal(due.getFullYear(), 2024);
    assert.equal(due.getMonth(), 4);
    assert.equal(due.getDate(), 29);
    const state = baseState({ firstLaunchAt: feb29.toISOString(), launchCount: 1 });
    assert.equal(getPendingMilestone(state, due), "month3");
    assert.equal(getPendingMilestone(state, new Date(due.getTime() - 1)), null);
  });

  it("enforces 14-day gap between shows", () => {
    const state = baseState({
      launchCount: 20,
      shownMilestones: ["launch5"],
      lastShownAt: "2024-01-10T12:00:00.000Z",
    });
    assert.equal(getPendingMilestone(state, d("2024-01-23T12:00:00.000Z")), null);
    assert.equal(getPendingMilestone(state, d("2024-01-25T12:00:00.000Z")), "launch20");
  });

  it("skips missed milestones and shows only the latest eligible", () => {
    const state = baseState({
      launchCount: 3,
      firstLaunchAt: "2023-10-01T12:00:00.000Z",
      shownMilestones: [],
    });
    assert.equal(getPendingMilestone(state, d("2024-02-01T12:00:00.000Z")), "month3");
  });

  it("stops after all milestones were shown", () => {
    const state = baseState({
      shownMilestones: ["launch5", "launch20", "month3"],
      lastShownAt: "2024-06-01T12:00:00.000Z",
      launchCount: 50,
    });
    assert.equal(getPendingMilestone(state, d("2025-01-01T12:00:00.000Z")), null);
  });

  it("neverShowAgain disables pending milestones", () => {
    const state = baseState({ launchCount: 10, neverShowAgain: true });
    assert.equal(getPendingMilestone(state, d("2024-06-01T12:00:00.000Z")), null);
  });

  it("completeMilestone marks skipped lower milestones", () => {
    const next = completeMilestone(baseState(), "month3", d("2024-04-01T12:00:00.000Z"));
    assert.deepEqual(next.shownMilestones, ["launch5", "launch20", "month3"]);
    assert.equal(milestonesCompletedByShowing("month3").length, 3);
  });

  it("canShowSupportReminderNow respects host blockers", () => {
    const ready = {
      galleryReady: true,
      galleryReadyElapsedMs: 30_000,
      viewerOpen: false,
      overlayOpen: false,
      fileOpsBusy: false,
      windowFocused: true,
      fullscreenTransition: false,
    };
    assert.equal(canShowSupportReminderNow(ready, 30_000), true);
    assert.equal(canShowSupportReminderNow({ ...ready, viewerOpen: true }, 30_000), false);
    assert.equal(canShowSupportReminderNow({ ...ready, overlayOpen: true }, 30_000), false);
    assert.equal(canShowSupportReminderNow({ ...ready, fileOpsBusy: true }, 30_000), false);
    assert.equal(canShowSupportReminderNow({ ...ready, windowFocused: false }, 30_000), false);
    assert.equal(canShowSupportReminderNow({ ...ready, fullscreenTransition: true }, 30_000), false);
    assert.equal(canShowSupportReminderNow({ ...ready, galleryReadyElapsedMs: 1000 }, 30_000), false);
  });

  it("context menu / overlay and file ops only defer; pending milestone remains", () => {
    const state = baseState({ launchCount: 5 });
    const now = d("2024-01-10T12:00:00.000Z");
    assert.equal(getPendingMilestone(state, now), "launch5");
    assert.equal(
      canShowSupportReminderNow(
        {
          galleryReady: true,
          galleryReadyElapsedMs: 30_000,
          viewerOpen: false,
          overlayOpen: true,
          fileOpsBusy: false,
          windowFocused: true,
          fullscreenTransition: false,
        },
        30_000,
      ),
      false,
    );
    assert.equal(
      canShowSupportReminderNow(
        {
          galleryReady: true,
          galleryReadyElapsedMs: 30_000,
          viewerOpen: false,
          overlayOpen: false,
          fileOpsBusy: true,
          windowFocused: true,
          fullscreenTransition: false,
        },
        30_000,
      ),
      false,
    );
    assert.equal(getPendingMilestone(state, now), "launch5");
  });
});

describe("supportReminderState", () => {
  it("records one launch per session and persists", () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
    resetSupportReminderPersistenceFlags();
    const first = recordAppLaunch(d("2024-01-01T12:00:00.000Z"));
    assert.equal(first.launchCount, 1);
    const second = recordAppLaunch(d("2024-01-01T12:00:01.000Z"));
    assert.equal(second.launchCount, 1);
    sessionStorage.clear();
    const third = recordAppLaunch(d("2024-01-02T12:00:00.000Z"));
    assert.equal(third.launchCount, 2);
  });

  it("does not treat webview reload as a new launch", () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
    resetSupportReminderPersistenceFlags();
    recordAppLaunch();
    recordAppLaunch();
    assert.equal(loadSupportReminderState().launchCount, 1);
    assert.equal(sessionStorage.getItem(SUPPORT_REMINDER_SESSION_BOOT_KEY), "1");
  });

  it("survives reload from storage", () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
    resetSupportReminderPersistenceFlags();
    saveSupportReminderState(baseState({ launchCount: 7 }));
    assert.equal(loadSupportReminderState().launchCount, 7);
  });

  it("corrupted storage blocks shows and does not overwrite with a fresh launch", () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
    resetSupportReminderPersistenceFlags();
    localStorage.setItem(SUPPORT_REMINDER_STORAGE_KEY, "{broken");
    const state = loadSupportReminderState(d("2024-01-01T12:00:00.000Z"));
    assert.equal(persistenceBlockedThisSession(), true);
    assert.equal(state.launchCount, 0);
    assert.equal(readPendingMilestone(d("2024-06-01T12:00:00.000Z")), null);
    const after = recordAppLaunch(d("2024-01-02T12:00:00.000Z"));
    assert.equal(after.launchCount, 0);
    assert.equal(localStorage.getItem(SUPPORT_REMINDER_STORAGE_KEY), "{broken");
  });

  it("neverShowAgain survives reload and blocks pending", () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
    resetSupportReminderPersistenceFlags();
    saveSupportReminderState(baseState({ launchCount: 10 }));
    permanentlyDismissSupportReminders(d("2024-02-01T12:00:00.000Z"));
    sessionStorage.clear();
    resetSupportReminderPersistenceFlags();
    assert.equal(loadSupportReminderState().neverShowAgain, true);
    assert.equal(readPendingMilestone(d("2024-06-01T12:00:00.000Z")), null);
  });

  it("dismiss persists milestone and skips earlier stages when jumping to month3", () => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
    resetSupportReminderPersistenceFlags();
    saveSupportReminderState(baseState({ launchCount: 2 }));
    dismissSupportReminder("month3", d("2024-04-01T12:00:00.000Z"));
    const stored = loadSupportReminderState();
    assert.deepEqual(stored.shownMilestones, ["launch5", "launch20", "month3"]);
    assert.equal(readPendingMilestone(d("2025-01-01T12:00:00.000Z")), null);
  });

  it("normalizes unknown milestone values", () => {
    const state = normalizeSupportReminderState(
      { shownMilestones: ["launch5", "bogus", "month3"] },
      d("2024-01-01T12:00:00.000Z"),
    );
    assert.deepEqual(state.shownMilestones, ["launch5", "month3"]);
  });
});
