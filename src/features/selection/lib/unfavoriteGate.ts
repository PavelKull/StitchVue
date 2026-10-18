/** Логическая блокировка снятия избранного между проходами IPC и диалогами. */

export type UnfavoriteGate = {
  busy: boolean;
  sessionId: string | null;
  /** True while a confirm dialog is open and awaiting user choice. */
  confirmPending: boolean;
  /**
   * Токен текущего in-flight снятия (совпадает с sessionId при begin).
   * Устаревшие resolve после cancel/end должны отвергаться.
   */
  flightToken: string | null;
};

export function idleUnfavoriteGate(): UnfavoriteGate {
  return {
    busy: false,
    sessionId: null,
    confirmPending: false,
    flightToken: null,
  };
}

export function canStartUnfavorite(gate: UnfavoriteGate): boolean {
  return !gate.busy;
}

/** Совпадение токена активного in-flight (в т.ч. пока открыт confirm). */
export function matchesUnfavoriteFlight(
  gate: UnfavoriteGate,
  flightToken: string,
): boolean {
  return (
    gate.busy &&
    gate.flightToken !== null &&
    gate.flightToken === flightToken &&
    gate.sessionId === flightToken
  );
}

export function beginUnfavorite(sessionId: string): UnfavoriteGate {
  return {
    busy: true,
    sessionId,
    confirmPending: false,
    flightToken: sessionId,
  };
}

export function markUnfavoriteConfirmPending(gate: UnfavoriteGate): UnfavoriteGate {
  if (!gate.busy || !gate.sessionId || !gate.flightToken) {
    return gate;
  }
  return { ...gate, confirmPending: true };
}

/** Accept confirm/skip only for the active session that is waiting on a dialog. */
export function canResolveUnfavoriteConfirm(
  gate: UnfavoriteGate,
  sessionId: string,
): boolean {
  return (
    gate.busy &&
    gate.confirmPending &&
    gate.sessionId === sessionId &&
    matchesUnfavoriteFlight(gate, sessionId)
  );
}

/** Leave confirm mode but keep the lock for the second pass. */
export function beginUnfavoriteConfirmPass(
  gate: UnfavoriteGate,
  sessionId: string,
): UnfavoriteGate | null {
  if (!canResolveUnfavoriteConfirm(gate, sessionId)) {
    return null;
  }
  return {
    busy: true,
    sessionId,
    confirmPending: false,
    flightToken: sessionId,
  };
}

export function endUnfavorite(): UnfavoriteGate {
  return idleUnfavoriteGate();
}
