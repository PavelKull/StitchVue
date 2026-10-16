import { useEffect, useState } from "react";
import { useSupportReminder } from "../../features/support-reminder/model/useSupportReminder.ts";
import { SupportReminderDialog } from "./SupportReminderDialog.tsx";

export type GallerySupportReminderProps = {
  galleryReady: boolean;
  viewerOpen: boolean;
  overlayOpen: boolean;
  fileOpsBusy: boolean;
  fullscreenTransition: boolean;
};

export function GallerySupportReminder({
  galleryReady,
  viewerOpen,
  overlayOpen,
  fileOpsBusy,
  fullscreenTransition,
}: GallerySupportReminderProps) {
  const [windowFocused, setWindowFocused] = useState(
    () => document.hasFocus() && !document.hidden,
  );
  const [galleryReadySince, setGalleryReadySince] = useState<number | null>(null);

  useEffect(() => {
    function syncWindowActive() {
      setWindowFocused(document.hasFocus() && !document.hidden);
    }
    window.addEventListener("focus", syncWindowActive);
    window.addEventListener("blur", syncWindowActive);
    document.addEventListener("visibilitychange", syncWindowActive);
    return () => {
      window.removeEventListener("focus", syncWindowActive);
      window.removeEventListener("blur", syncWindowActive);
      document.removeEventListener("visibilitychange", syncWindowActive);
    };
  }, []);

  useEffect(() => {
    if (!galleryReady) {
      setGalleryReadySince(null);
      return;
    }
    setGalleryReadySince((prev) => prev ?? Date.now());
  }, [galleryReady]);

  const reminder = useSupportReminder({
    galleryReady,
    galleryReadySince,
    viewerOpen,
    overlayOpen,
    fileOpsBusy,
    windowFocused,
    fullscreenTransition,
  });

  return (
    <SupportReminderDialog
      open={reminder.open}
      milestone={reminder.milestone}
      onDismiss={reminder.onDismiss}
      onNeverShowAgain={reminder.onNeverShowAgain}
      onDonateActionComplete={reminder.onDonateActionComplete}
    />
  );
}
