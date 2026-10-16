export type FolderRefreshRunner = (path: string) => Promise<void>;

/** Runs at most one refresh at a time; a burst queues a single follow-up. */
export function coalesceFolderRefresh(run: FolderRefreshRunner): (path: string) => void {
  let inFlight = false;
  let queued: string | null = null;

  const pump = async (path: string) => {
    if (inFlight) {
      queued = path;
      return;
    }
    inFlight = true;
    try {
      await run(path);
    } finally {
      inFlight = false;
      if (queued !== null) {
        const next = queued;
        queued = null;
        void pump(next);
      }
    }
  };

  return (path: string) => {
    void pump(path);
  };
}
