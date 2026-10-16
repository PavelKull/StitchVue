/** Logical lock for favorite-removal across file passes and confirm dialogs. */

export type UnfavoriteGate = {
  busy: boolean;
  sessionId: string | null;
  /** True while a confirm dialog is open and awaiting user choice. */
  confirmPending: boolean;
};

export function idleUnfavoriteGate(): UnfavoriteGate {
  return { busy: false, sessionId: null, confirmPending: false };
}

export function canStartUnfavorite(gate: UnfavoriteGate): boolean {
  return !gate.busy;
}

export function beginUnfavorite(sessionId: string): UnfavoriteGate {
  return { busy: true, sessionId, confirmPending: false };
}

export function markUnfavoriteConfirmPending(gate: UnfavoriteGate): UnfavoriteGate {
  if (!gate.busy || !gate.sessionId) {
    return gate;
  }
  return { ...gate, confirmPending: true };
}

/** Accept confirm/skip only for the active session that is waiting on a dialog. */
export function canResolveUnfavoriteConfirm(gate: UnfavoriteGate, sessionId: string): boolean {
  return gate.busy && gate.confirmPending && gate.sessionId === sessionId;
}

/** Leave confirm mode but keep the lock for the second pass. */
export function beginUnfavoriteConfirmPass(gate: UnfavoriteGate, sessionId: string): UnfavoriteGate | null {
  if (!canResolveUnfavoriteConfirm(gate, sessionId)) {
    return null;
  }
  return { busy: true, sessionId, confirmPending: false };
}

export function endUnfavorite(): UnfavoriteGate {
  return idleUnfavoriteGate();
}
