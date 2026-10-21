import { invoke } from "@tauri-apps/api/core";

export function fileOperationInProgress(): Promise<boolean> {
  return invoke<boolean>("file_operation_in_progress");
}

export function beginAppUpdatePrepare(): Promise<void> {
  return invoke<void>("begin_app_update_prepare");
}

export function endAppUpdatePrepare(): Promise<void> {
  return invoke<void>("end_app_update_prepare");
}
