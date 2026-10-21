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
  beginAppUpdatePrepare,
  endAppUpdatePrepare,
  fileOperationInProgress,
} from "./api/updateGateIpc";
import { checkForUpdate, downloadUpdateWithProgress, installUpdate, type AvailableUpdate } from "./api/updater";
import {
  canStartUpdate,
  classifyUpdateError,
  initialUpdateSnapshot,
  type UpdateErrorKey,
  type UpdateSnapshot,
} from "./lib/updateLifecycle";
import { UpdateDialog } from "./ui/UpdateDialog";

export type AboutUpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate"; version: string }
  | { kind: "available"; version: string }
  | { kind: "error"; errorKey: UpdateErrorKey };

type AppUpdateContextValue = {
  openUpdateDialog: () => void;
  aboutUpdateStatus: AboutUpdateStatus;
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

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [installedVersion, setInstalledVersion] = useState("—");
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>(initialUpdateSnapshot);
  const [aboutUpdateStatus, setAboutUpdateStatus] = useState<AboutUpdateStatus>({ kind: "idle" });
  const [operationsBlocked, setOperationsBlocked] = useState(false);
  const availableRef = useRef<AvailableUpdate | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    void getVersion()
      .then((value) => setInstalledVersion(value || "—"))
      .catch(() => setInstalledVersion("—"));
  }, []);

  useEffect(() => {
    availableRef.current = available;
  }, [available]);

  const releasePendingUpdate = useCallback(async () => {
    const pending = availableRef.current;
    availableRef.current = null;
    setAvailable(null);
    if (pending) {
      try {
        await pending.raw.close();
      } catch {
        /* resource already released */
      }
    }
  }, []);

  const closeDialog = useCallback(() => {
    if (snapshot.phase === "downloading" || snapshot.phase === "installing" || snapshot.phase === "arming") {
      return;
    }
    setOpen(false);
    setSnapshot(initialUpdateSnapshot());
    void releasePendingUpdate();
  }, [releasePendingUpdate, snapshot.phase]);

  const runCheck = useCallback(
    async (opts: { manual: boolean }) => {
      if (opts.manual) {
        setAboutUpdateStatus({ kind: "checking" });
      }
      setSnapshot({ phase: "checking", progress: 0, errorKey: null });
      try {
        const update = await checkForUpdate();
        if (!update) {
          if (opts.manual) {
            setAvailable(null);
            setSnapshot({ phase: "upToDate", progress: 0, errorKey: null });
            setAboutUpdateStatus({ kind: "upToDate", version: installedVersion });
            setOpen(true);
          } else {
            setSnapshot(initialUpdateSnapshot());
          }
          return;
        }
        await releasePendingUpdate();
        setAvailable(update);
        setSnapshot({ phase: "prompt", progress: 0, errorKey: null });
        if (opts.manual) {
          setAboutUpdateStatus({ kind: "available", version: update.version });
        }
        setOpen(true);
      } catch {
        // Автопроверка молчит при сети/endpoint; ручная — показывает ошибку.
        if (opts.manual) {
          setSnapshot({ phase: "error", progress: 0, errorKey: "network" });
          setAboutUpdateStatus({ kind: "error", errorKey: "network" });
          setOpen(true);
        } else {
          setSnapshot(initialUpdateSnapshot());
        }
      }
    },
    [installedVersion, releasePendingUpdate],
  );

  const openUpdateDialog = useCallback(() => {
    void runCheck({ manual: true });
  }, [runCheck]);

  const runCheckRef = useRef(runCheck);
  useEffect(() => {
    runCheckRef.current = runCheck;
  }, [runCheck]);

  useEffect(() => {
    // Таймер не зависит от runCheck: загрузка версии иначе снимает его до проверки.
    // Сеть и модалка — только после паузы, чтобы не тормозить открытие папок.
    const timer = window.setTimeout(() => {
      void runCheckRef.current({ manual: false });
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, []);

  const startUpdate = useCallback(async () => {
    if (!canStartUpdate(snapshot.phase) || startingRef.current) {
      return;
    }
    const update = availableRef.current;
    if (!update) {
      return;
    }
    if (operationsBlocked) {
      setSnapshot({ phase: "error", progress: 0, errorKey: "blocked" });
      return;
    }
    startingRef.current = true;
    setSnapshot({ phase: "arming", progress: 0, errorKey: null });
    try {
      const busy = await fileOperationInProgress();
      if (busy || operationsBlocked) {
        setSnapshot({ phase: "error", progress: 0, errorKey: "blocked" });
        return;
      }
      try {
        await beginAppUpdatePrepare();
      } catch {
        setSnapshot({ phase: "error", progress: 0, errorKey: "prepare" });
        return;
      }
      setSnapshot({ phase: "downloading", progress: 0, errorKey: null });
      try {
        await downloadUpdateWithProgress(update.raw, (progress) => {
          setSnapshot({ phase: "downloading", progress, errorKey: null });
        });
        setSnapshot({ phase: "installing", progress: 100, errorKey: null });
        await endAppUpdatePrepare();
        await installUpdate(update.raw);
      } catch (error) {
        await endAppUpdatePrepare();
        setSnapshot({ phase: "error", progress: 0, errorKey: classifyUpdateError(error) });
      }
    } finally {
      startingRef.current = false;
    }
  }, [operationsBlocked, snapshot.phase]);

  const contextValue = useMemo(
    () => ({
      openUpdateDialog,
      aboutUpdateStatus,
      setUpdateOperationsBlocked: setOperationsBlocked,
    }),
    [aboutUpdateStatus, openUpdateDialog],
  );

  return (
    <AppUpdateContext.Provider value={contextValue}>
      {children}
      <UpdateDialog
        open={open}
        installedVersion={installedVersion}
        availableVersion={available?.version ?? ""}
        releaseNotes={available?.body ?? ""}
        phase={snapshot.phase}
        progress={snapshot.progress}
        errorKey={snapshot.errorKey}
        operationsBlocked={operationsBlocked}
        onLater={closeDialog}
        onUpdate={() => void startUpdate()}
        onRetry={() => void startUpdate()}
        onClose={closeDialog}
      />
    </AppUpdateContext.Provider>
  );
}
