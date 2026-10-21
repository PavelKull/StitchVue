export type UpdatePhase =
  | "idle"
  | "checking"
  | "prompt"
  | "upToDate"
  | "arming"
  | "downloading"
  | "installing"
  | "error";

export type UpdateErrorKey = "blocked" | "network" | "prepare" | "signature" | "install";

export type UpdateSnapshot = {
  phase: UpdatePhase;
  progress: number;
  errorKey: UpdateErrorKey | null;
};

export function initialUpdateSnapshot(): UpdateSnapshot {
  return { phase: "idle", progress: 0, errorKey: null };
}

/** Primary Update action is blocked while file work is active (prompt / retry). */
export function updateActionBlocked(blocked: boolean, phase: UpdatePhase): boolean {
  return blocked && (phase === "prompt" || phase === "error");
}

/** N-12: ignore second Update click while already arming/downloading/installing. */
export function canStartUpdate(phase: UpdatePhase): boolean {
  return phase === "prompt" || phase === "error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error ?? "");
}

/** Map plugin/network failures to UI error keys (check stays network-only). */
export function classifyUpdateError(error: unknown): UpdateErrorKey {
  const message = errorMessage(error).toLowerCase();
  if (
    message.includes("signature") ||
    message.includes("minisign") ||
    message.includes("verify") ||
    message.includes("public key") ||
    message.includes("pubkey")
  ) {
    return "signature";
  }
  if (
    message.includes("install") ||
    message.includes("nsis") ||
    message.includes("setup") ||
    message.includes("restart")
  ) {
    return "install";
  }
  return "network";
}
