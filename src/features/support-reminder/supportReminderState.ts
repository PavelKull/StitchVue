import { completeMilestone, getPendingMilestone, setNeverShowAgain } from "./supportReminderLogic.ts";
import {
  SUPPORT_REMINDER_SESSION_BOOT_KEY,
  SUPPORT_REMINDER_STORAGE_KEY,
  type SupportMilestone,
  type SupportReminderState,
} from "./supportReminderTypes.ts";

const EMPTY_STATE: SupportReminderState = {
  launchCount: 0,
  firstLaunchAt: "",
  lastShownAt: null,
  shownMilestones: [],
  neverShowAgain: false,
};

let persistenceFailedThisSession = false;

function isMilestone(value: unknown): value is SupportMilestone {
  return value === "launch5" || value === "launch20" || value === "month3";
}

export function normalizeSupportReminderState(raw: unknown, _now: Date): SupportReminderState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_STATE };
  }
  const parsed = raw as Record<string, unknown>;
  const launchCount =
    typeof parsed.launchCount === "number" && Number.isFinite(parsed.launchCount) && parsed.launchCount >= 0
      ? Math.floor(parsed.launchCount)
      : 0;
  const firstLaunchAt = typeof parsed.firstLaunchAt === "string" ? parsed.firstLaunchAt : "";
  const lastShownAt = typeof parsed.lastShownAt === "string" ? parsed.lastShownAt : null;
  const shownMilestones = Array.isArray(parsed.shownMilestones)
    ? parsed.shownMilestones.filter(isMilestone)
    : [];
  const neverShowAgain = parsed.neverShowAgain === true;
  return {
    launchCount,
    firstLaunchAt,
    lastShownAt,
    shownMilestones,
    neverShowAgain,
  };
}

export function loadSupportReminderState(now = new Date()): SupportReminderState {
  try {
    const raw = localStorage.getItem(SUPPORT_REMINDER_STORAGE_KEY);
    if (!raw) {
      return normalizeSupportReminderState(null, now);
    }
    return normalizeSupportReminderState(JSON.parse(raw) as unknown, now);
  } catch {
    // Avoid re-showing reminders after storage damage (neverShowAgain / milestones lost).
    persistenceFailedThisSession = true;
    return normalizeSupportReminderState(null, now);
  }
}

export function saveSupportReminderState(state: SupportReminderState): boolean {
  if (persistenceFailedThisSession) {
    return false;
  }
  try {
    localStorage.setItem(SUPPORT_REMINDER_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    persistenceFailedThisSession = true;
    return false;
  }
}

export function persistenceBlockedThisSession(): boolean {
  return persistenceFailedThisSession;
}

export function recordAppLaunch(now = new Date()): SupportReminderState {
  const state = loadSupportReminderState(now);
  if (persistenceFailedThisSession) {
    return state;
  }
  try {
    if (sessionStorage.getItem(SUPPORT_REMINDER_SESSION_BOOT_KEY) === "1") {
      return state;
    }
    sessionStorage.setItem(SUPPORT_REMINDER_SESSION_BOOT_KEY, "1");
  } catch {
    // Cannot prove process uniqueness — skip increment to avoid double-counting.
    return state;
  }
  const next: SupportReminderState = {
    ...state,
    launchCount: state.launchCount + 1,
    firstLaunchAt: state.firstLaunchAt || now.toISOString(),
  };
  saveSupportReminderState(next);
  return next;
}

export function readPendingMilestone(now = new Date()): SupportMilestone | null {
  if (persistenceFailedThisSession) {
    return null;
  }
  const state = loadSupportReminderState(now);
  return getPendingMilestone(state, now);
}

export function dismissSupportReminder(milestone: SupportMilestone, now = new Date()): void {
  const state = loadSupportReminderState(now);
  const next = completeMilestone(state, milestone, now);
  saveSupportReminderState(next);
}

export function permanentlyDismissSupportReminders(now = new Date()): void {
  const state = loadSupportReminderState(now);
  saveSupportReminderState(setNeverShowAgain(state));
}

/** Settings toggle: opt out of / restore automatic support reminders. */
export function setSupportReminderNeverShowAgain(value: boolean, now = new Date()): void {
  const state = loadSupportReminderState(now);
  saveSupportReminderState({ ...state, neverShowAgain: value });
}

/** Test helper */
export function resetSupportReminderPersistenceFlags(): void {
  persistenceFailedThisSession = false;
}
