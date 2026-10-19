# IPC Contract: app-update extensions

**Register in**: `src-tauri/src/lib.rs`  
**Implement in**: `src-tauri/src/commands/mod.rs`  
**Domain logic**: `src-tauri/src/file_ops/mod.rs`

## Commands (new)

### `file_operation_in_progress`

- **Input**: none  
- **Output**: `boolean` — `true` if `file_ops` registry `active` map non-empty.  
- **Errors**: none (always returns bool).  
- **Side effects**: none.

### `begin_app_update_prepare`

- **Input**: none  
- **Output**: `null` on success  
- **Errors**:  
  - `file_operation_in_progress` — active map non-empty  
  - `update_prepare_failed` — race detected on double-check  
- **Side effects**: sets `UPDATE_PREPARE`; new `run_file_operation` claims return Busy until `end`.

### `end_app_update_prepare`

- **Input**: none  
- **Output**: `null`  
- **Side effects**: clears `UPDATE_PREPARE` (idempotent).

## Unchanged commands

`run_file_operation`, `cancel_file_operation` — semantics unchanged (I6).  
When `UPDATE_PREPARE` set, **new** `claim` → `Busy` (same error string as concurrent op).

## Frontend invoke names

Use camelCase per existing Tauri conventions:  
`fileOperationInProgress`, `beginAppUpdatePrepare`, `endAppUpdatePrepare`.

## Events

No new backend events. Updater progress via `@tauri-apps/plugin-updater` JS API.

## docs sync

Update `docs/IPC.md` § new group «App update / file gate» after Stage 1.
