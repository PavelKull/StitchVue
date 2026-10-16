export type SupportMilestone = "launch5" | "launch20" | "month3";

export type SupportReminderState = {
  launchCount: number;
  firstLaunchAt: string;
  lastShownAt: string | null;
  shownMilestones: SupportMilestone[];
  neverShowAgain: boolean;
};

export const SUPPORT_REMINDER_STORAGE_KEY = "stitchvue.supportReminder.v1";
export const SUPPORT_REMINDER_SESSION_BOOT_KEY = "stitchvue.supportReminder.boot";

/**
 * TEMP debug: show the support dialog once per app launch (after gallery is ready).
 * Set to `false` to restore the production schedule (5/20 launches, 3 months, etc.).
 * While true, dismiss does not write milestones / neverShowAgain so each launch can preview again.
 */
export const SUPPORT_REMINDER_DEBUG_SHOW_ON_LAUNCH = false;

/** Stage layout used while SUPPORT_REMINDER_DEBUG_SHOW_ON_LAUNCH is true. */
export const SUPPORT_REMINDER_DEBUG_MILESTONE: SupportMilestone = "launch5";

export const GALLERY_READY_DELAY_MS = 30_000;
/** Delay before debug-on-launch preview (production uses GALLERY_READY_DELAY_MS). */
export const SUPPORT_REMINDER_DEBUG_DELAY_MS = 1_500;
export const MIN_DAYS_BEFORE_LAUNCH5 = 3;
export const MIN_DAYS_BEFORE_LAUNCH20 = 14;
export const MIN_DAYS_BETWEEN_SHOWS = 14;
export const MIN_LAUNCH_COUNT_LAUNCH5 = 5;
export const MIN_LAUNCH_COUNT_LAUNCH20 = 20;
