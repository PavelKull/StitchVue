export type MockUpdatePhase = "prompt" | "downloading" | "error" | "ready";

export type MockUpdateSnapshot = {
  phase: MockUpdatePhase;
  progress: number;
};

export function initialMockUpdateSnapshot(): MockUpdateSnapshot {
  return { phase: "prompt", progress: 0 };
}

export function mockUpdateBlocked(blocked: boolean, phase: MockUpdatePhase): boolean {
  return blocked && (phase === "prompt" || phase === "downloading");
}
