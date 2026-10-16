import {
  MIN_DAYS_BEFORE_LAUNCH5,
  MIN_DAYS_BEFORE_LAUNCH20,
  MIN_DAYS_BETWEEN_SHOWS,
  MIN_LAUNCH_COUNT_LAUNCH5,
  MIN_LAUNCH_COUNT_LAUNCH20,
  type SupportMilestone,
  type SupportReminderState,
} from "./supportReminderTypes.ts";

const MILESTONE_RANK: Record<SupportMilestone, number> = {
  launch5: 0,
  launch20: 1,
  month3: 2,
};

const MILESTONES_DESC: SupportMilestone[] = ["month3", "launch20", "launch5"];
const ALL_MILESTONES: SupportMilestone[] = ["launch5", "launch20", "month3"];

export function parseIsoDate(value: string): Date | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return null;
  }
  return new Date(time);
}

/** Calendar months from anchor (local date parts). Clamps end-of-month overflow. */
export function addCalendarMonths(anchor: Date, months: number): Date {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const day = anchor.getDate();
  const targetMonthStart = new Date(
    year,
    month + months,
    1,
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
    anchor.getMilliseconds(),
  );
  const lastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate();
  targetMonthStart.setDate(Math.min(day, lastDay));
  return targetMonthStart;
}

export function calendarDaysBetween(startIso: string, end: Date): number | null {
  const start = parseIsoDate(startIso);
  if (!start) {
    return null;
  }
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.floor((endDay - startDay) / 86_400_000);
}

function isMilestoneEligible(
  milestone: SupportMilestone,
  state: SupportReminderState,
  now: Date,
): boolean {
  const ageDays = calendarDaysBetween(state.firstLaunchAt, now);
  if (ageDays === null) {
    return false;
  }
  switch (milestone) {
    case "launch5":
      return state.launchCount >= MIN_LAUNCH_COUNT_LAUNCH5 && ageDays >= MIN_DAYS_BEFORE_LAUNCH5;
    case "launch20":
      return state.launchCount >= MIN_LAUNCH_COUNT_LAUNCH20 && ageDays >= MIN_DAYS_BEFORE_LAUNCH20;
    case "month3": {
      const first = parseIsoDate(state.firstLaunchAt);
      if (!first) {
        return false;
      }
      const due = addCalendarMonths(first, 3);
      return now.getTime() >= due.getTime();
    }
    default:
      return false;
  }
}

export function getPendingMilestone(state: SupportReminderState, now: Date): SupportMilestone | null {
  if (state.neverShowAgain) {
    return null;
  }
  if (ALL_MILESTONES.every((m) => state.shownMilestones.includes(m))) {
    return null;
  }
  if (state.lastShownAt) {
    const since = calendarDaysBetween(state.lastShownAt, now);
    if (since !== null && since < MIN_DAYS_BETWEEN_SHOWS) {
      return null;
    }
  }
  for (const milestone of MILESTONES_DESC) {
    if (state.shownMilestones.includes(milestone)) {
      continue;
    }
    if (isMilestoneEligible(milestone, state, now)) {
      return milestone;
    }
  }
  return null;
}

export function milestonesCompletedByShowing(milestone: SupportMilestone): SupportMilestone[] {
  const rank = MILESTONE_RANK[milestone];
  return ALL_MILESTONES.filter((m) => MILESTONE_RANK[m] <= rank);
}

export function completeMilestone(
  state: SupportReminderState,
  milestone: SupportMilestone,
  now: Date,
): SupportReminderState {
  const add = milestonesCompletedByShowing(milestone);
  const shown = new Set(state.shownMilestones);
  for (const m of add) {
    shown.add(m);
  }
  return {
    ...state,
    shownMilestones: ALL_MILESTONES.filter((m) => shown.has(m)),
    lastShownAt: now.toISOString(),
  };
}

export function setNeverShowAgain(state: SupportReminderState): SupportReminderState {
  return { ...state, neverShowAgain: true };
}

export type SupportReminderShowContext = {
  galleryReady: boolean;
  galleryReadyElapsedMs: number;
  viewerOpen: boolean;
  overlayOpen: boolean;
  fileOpsBusy: boolean;
  windowFocused: boolean;
  fullscreenTransition: boolean;
};

export function canShowSupportReminderNow(
  context: SupportReminderShowContext,
  galleryReadyDelayMs: number,
): boolean {
  if (!context.galleryReady) {
    return false;
  }
  if (context.galleryReadyElapsedMs < galleryReadyDelayMs) {
    return false;
  }
  if (!context.windowFocused) {
    return false;
  }
  if (context.viewerOpen) {
    return false;
  }
  if (context.overlayOpen) {
    return false;
  }
  if (context.fileOpsBusy) {
    return false;
  }
  if (context.fullscreenTransition) {
    return false;
  }
  return true;
}
