import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  MOCK_AVAILABLE_VERSION,
  MOCK_INSTALLED_VERSION,
  MOCK_RELEASE_NOTES,
  MOCK_UPDATE_AUTO_PROMPT_DEV,
} from "./mock/fixture";
import { initialMockUpdateSnapshot } from "./model/mockUpdateFlow";
import { UpdateDialog } from "./ui/UpdateDialog";

type AppUpdateContextValue = {
  openUpdateDialog: () => void;
  setUpdateOperationsBlocked: (blocked: boolean) => void;
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function useAppUpdate(): AppUpdateContextValue {
  const value = useContext(AppUpdateContext);
  if (!value) {
    throw new Error("useAppUpdate must be used within AppUpdateProvider");
  }
  return value;
}

const AUTO_PROMPT_KEY = "stitchvue-mock-update-auto-prompt";

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [installedVersion, setInstalledVersion] = useState(MOCK_INSTALLED_VERSION);
  const [snapshot, setSnapshot] = useState(initialMockUpdateSnapshot);
  const [operationsBlocked, setOperationsBlocked] = useState(false);
  const downloadTimerRef = useRef(0);

  useEffect(() => {
    void getVersion()
      .then((value) => setInstalledVersion(value || MOCK_INSTALLED_VERSION))
      .catch(() => setInstalledVersion(MOCK_INSTALLED_VERSION));
  }, []);

  const resetFlow = useCallback(() => {
    window.clearInterval(downloadTimerRef.current);
    downloadTimerRef.current = 0;
    setSnapshot(initialMockUpdateSnapshot());
  }, []);

  const openUpdateDialog = useCallback(() => {
    resetFlow();
    setOpen(true);
  }, [resetFlow]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    resetFlow();
  }, [resetFlow]);

  const startMockDownload = useCallback(() => {
    if (operationsBlocked) {
      return;
    }
    setSnapshot({ phase: "downloading", progress: 0 });
    window.clearInterval(downloadTimerRef.current);
    let progress = 0;
    downloadTimerRef.current = window.setInterval(() => {
      progress = Math.min(100, progress + 8);
      setSnapshot({ phase: "downloading", progress });
      if (progress >= 100) {
        window.clearInterval(downloadTimerRef.current);
        downloadTimerRef.current = 0;
        setSnapshot({ phase: "ready", progress: 100 });
      }
    }, 120);
  }, [operationsBlocked]);

  useEffect(() => {
    return () => window.clearInterval(downloadTimerRef.current);
  }, []);

  useEffect(() => {
    if (!MOCK_UPDATE_AUTO_PROMPT_DEV) {
      return;
    }
    if (sessionStorage.getItem(AUTO_PROMPT_KEY)) {
      return;
    }
    const timer = window.setTimeout(() => {
      sessionStorage.setItem(AUTO_PROMPT_KEY, "1");
      openUpdateDialog();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [openUpdateDialog]);

  const contextValue = useMemo(
    () => ({
      openUpdateDialog,
      setUpdateOperationsBlocked: setOperationsBlocked,
    }),
    [openUpdateDialog],
  );

  return (
    <AppUpdateContext.Provider value={contextValue}>
      {children}
      <UpdateDialog
        open={open}
        installedVersion={installedVersion}
        availableVersion={MOCK_AVAILABLE_VERSION}
        releaseNotes={MOCK_RELEASE_NOTES}
        phase={snapshot.phase}
        progress={snapshot.progress}
        operationsBlocked={operationsBlocked}
        onLater={closeDialog}
        onUpdate={startMockDownload}
        onRetry={startMockDownload}
        onCloseReady={closeDialog}
        onPreviewError={() => setSnapshot({ phase: "error", progress: 0 })}
      />
    </AppUpdateContext.Provider>
  );
}
