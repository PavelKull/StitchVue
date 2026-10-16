import { useCallback, useEffect, useRef, useState } from "react";
import {
  GALLERY_READY_DELAY_MS,
  SUPPORT_REMINDER_DEBUG_DELAY_MS,
  SUPPORT_REMINDER_DEBUG_MILESTONE,
  SUPPORT_REMINDER_DEBUG_SHOW_ON_LAUNCH,
} from "./supportReminderTypes.ts";
import { canShowSupportReminderNow, type SupportReminderShowContext } from "./supportReminderLogic.ts";
import type { SupportMilestone } from "./supportReminderTypes.ts";
import {
  dismissSupportReminder,
  permanentlyDismissSupportReminders,
  persistenceBlockedThisSession,
  readPendingMilestone,
  recordAppLaunch,
} from "./supportReminderState.ts";

export type SupportReminderHostSnapshot = {
  galleryReady: boolean;
  galleryReadySince: number | null;
  viewerOpen: boolean;
  overlayOpen: boolean;
  fileOpsBusy: boolean;
  windowFocused: boolean;
  fullscreenTransition: boolean;
};

export function useSupportReminder(snapshot: SupportReminderHostSnapshot) {
  const [open, setOpen] = useState(false);
  const [milestone, setMilestone] = useState<SupportMilestone | null>(null);
  const milestoneRef = useRef<SupportMilestone | null>(null);
  const shownThisLaunchRef = useRef(false);
  const openLockRef = useRef(false);
  const debugMode = SUPPORT_REMINDER_DEBUG_SHOW_ON_LAUNCH;
  const readyDelayMs = debugMode ? SUPPORT_REMINDER_DEBUG_DELAY_MS : GALLERY_READY_DELAY_MS;

  useEffect(() => {
    recordAppLaunch();
    if (debugMode) {
      milestoneRef.current = SUPPORT_REMINDER_DEBUG_MILESTONE;
      return;
    }
    milestoneRef.current = readPendingMilestone();
  }, [debugMode]);

  const tryOpen = useCallback(() => {
    if (shownThisLaunchRef.current || openLockRef.current || open) {
      return;
    }
    if (!debugMode && persistenceBlockedThisSession()) {
      return;
    }
    const nextMilestone = debugMode
      ? SUPPORT_REMINDER_DEBUG_MILESTONE
      : (milestoneRef.current ?? readPendingMilestone());
    if (!nextMilestone) {
      return;
    }
    const readySince = snapshot.galleryReadySince;
    const elapsed =
      snapshot.galleryReady && readySince !== null ? Math.max(0, Date.now() - readySince) : 0;
    const context: SupportReminderShowContext = {
      galleryReady: snapshot.galleryReady,
      galleryReadyElapsedMs: elapsed,
      viewerOpen: snapshot.viewerOpen,
      overlayOpen: snapshot.overlayOpen,
      fileOpsBusy: snapshot.fileOpsBusy,
      windowFocused: snapshot.windowFocused,
      fullscreenTransition: snapshot.fullscreenTransition,
    };
    if (!canShowSupportReminderNow(context, readyDelayMs)) {
      return;
    }
    openLockRef.current = true;
    milestoneRef.current = nextMilestone;
    shownThisLaunchRef.current = true;
    setMilestone(nextMilestone);
    setOpen(true);
  }, [open, snapshot, debugMode, readyDelayMs]);

  useEffect(() => {
    tryOpen();
  }, [tryOpen]);

  useEffect(() => {
    if (!snapshot.galleryReady || snapshot.galleryReadySince === null) {
      return;
    }
    const elapsed = Date.now() - snapshot.galleryReadySince;
    const remaining = readyDelayMs - elapsed;
    if (remaining <= 0) {
      tryOpen();
      return;
    }
    const timer = window.setTimeout(() => {
      tryOpen();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [snapshot.galleryReady, snapshot.galleryReadySince, tryOpen, readyDelayMs]);

  useEffect(() => {
    function onFocus() {
      tryOpen();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [tryOpen]);

  const closeAfterDismiss = useCallback(() => {
    const current = milestoneRef.current;
    setOpen(false);
    openLockRef.current = false;
    setMilestone(null);
    milestoneRef.current = null;
    if (!debugMode && current) {
      dismissSupportReminder(current);
    }
  }, [debugMode]);

  const closeAfterNever = useCallback(() => {
    setOpen(false);
    openLockRef.current = false;
    milestoneRef.current = null;
    setMilestone(null);
    if (!debugMode) {
      permanentlyDismissSupportReminders();
    }
  }, [debugMode]);

  const closeAfterDonate = useCallback(() => {
    const current = milestoneRef.current;
    setOpen(false);
    openLockRef.current = false;
    setMilestone(null);
    milestoneRef.current = null;
    if (!debugMode && current) {
      dismissSupportReminder(current);
    }
  }, [debugMode]);

  return {
    open,
    milestone,
    onDismiss: closeAfterDismiss,
    onNeverShowAgain: closeAfterNever,
    onDonateActionComplete: closeAfterDonate,
  };
}
