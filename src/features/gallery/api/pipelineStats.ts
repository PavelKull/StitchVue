import { invoke } from "@tauri-apps/api/core";

export type PipelineStats = {
  pass: string;
  ready: number;
  pending: number;
  failed: number;
  cacheHits: number;
  cacheMisses: number;
  readsInUse: number;
  decodesInUse: number;
  cancelled: number;
  cacheBytes: number;
  backgroundPerSec: number;
  cacheCapped: boolean;
  rawDevelopMs: number;
  viewerCacheHits: number;
  decodePeakMb: number;
  staleTasks: number;
  schedulerMode: string;
  pendingP1: number;
  pendingP4: number;
  pendingP5: number;
  backgroundCompleted: number;
  backgroundYields: number;
  viewportBaseReady: boolean;
  viewportQualityReady: boolean;
};

export function fetchPipelineStats(): Promise<PipelineStats> {
  return invoke<PipelineStats>("pipeline_stats");
}
