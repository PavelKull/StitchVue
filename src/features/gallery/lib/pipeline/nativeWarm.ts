export const NATIVE_WARM_CAP = 1;
export const NATIVE_KEPT_CAP = 8;

export type NativeWarmState = {
  active: number;
  pending: string | null;
  kept: string[];
};

export function emptyNativeWarm(): NativeWarmState {
  return { active: 0, pending: null, kept: [] };
}

export function requestNativeWarm(state: NativeWarmState, path: string): { state: NativeWarmState; start: string | null } {
  if (state.kept.includes(path)) {
    return {
      state: { ...state, pending: null, kept: retain(state.kept, path) },
      start: null,
    };
  }
  if (state.active >= NATIVE_WARM_CAP) {
    return { state: { ...state, pending: path }, start: null };
  }
  return {
    state: {
      active: state.active + 1,
      pending: state.pending === path ? null : state.pending,
      kept: retain(state.kept, path),
    },
    start: path,
  };
}

export function finishNativeWarm(state: NativeWarmState): { state: NativeWarmState; start: string | null } {
  const active = Math.max(0, state.active - 1);
  const next = state.pending;
  if (!next || state.kept.includes(next) || active >= NATIVE_WARM_CAP) {
    return {
      state: { ...state, active, pending: next && state.kept.includes(next) ? null : state.pending },
      start: null,
    };
  }
  return {
    state: { active: active + 1, pending: null, kept: retain(state.kept, next) },
    start: next,
  };
}

export function cancelNativeWarm(state: NativeWarmState): NativeWarmState {
  return { ...state, pending: null };
}

export function promoteNativeWarm(state: NativeWarmState, path: string): NativeWarmState {
  return {
    ...state,
    pending: state.pending === path ? path : null,
    kept: state.kept.includes(path) ? retain(state.kept, path) : state.kept,
  };
}

export function retainNativeWarm(state: NativeWarmState, path: string): NativeWarmState {
  return { ...state, pending: null, kept: retain(state.kept, path) };
}

export function forgetNativeWarm(state: NativeWarmState, path: string): NativeWarmState {
  return {
    ...state,
    pending: state.pending === path ? null : state.pending,
    kept: state.kept.filter((item) => item !== path),
  };
}

function retain(kept: readonly string[], path: string): string[] {
  const next = kept.filter((item) => item !== path);
  next.push(path);
  if (next.length > NATIVE_KEPT_CAP) {
    return next.slice(next.length - NATIVE_KEPT_CAP);
  }
  return next;
}
