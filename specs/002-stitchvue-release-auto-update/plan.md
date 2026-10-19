# Implementation Plan: stitchvue-release-auto-update

**Branch** (optional): `002-stitchvue-release-auto-update`  
**Date**: 2026-10-17  
**Spec**: [`spec.md`](./spec.md)

## Summary

Внедрить **официальный Tauri 2 Updater** и **GitHub Actions** (`tauri-action`) для подписанных NSIS-релизов и `latest.json`. На frontend — новый FSD-срез `src/features/app-update/`, подключённый из `src/app/App.tsx`, без рефакторинга галереи: один раз при старте `check()`, modal с consent, progress, ошибки. На backend — минимальные IPC: probe busy + **атомарная фаза prepare** (блокировка **новых** `run_file_operation` до завершения download/install или отмены), без изменения `execute`/`claim` семантики для уже идущих ops.

Тестовые релизы (`v0.1.100-test.*`, `prerelease: true`) отделены от публичного Latest. Ключи: pubkey в git, privkey только Secrets + offline backup (документировано).

---

## Technical Context

| Item | Value |
|------|--------|
| Stack | Tauri **2.12.1**, React 19, TypeScript, Rust 2021 |
| Updater crates | `tauri-plugin-updater` **2.12.0**, `@tauri-apps/plugin-updater` **2.12.0** |
| Bundle | NSIS x64 only (`tauri.conf.json`) |
| App data | `%LOCALAPPDATA%\StitchVue\` (`src-tauri/src/database/mod.rs`) |
| File ops registry | `file_ops::registry()` — `active: HashMap<operation_id, cancel>` (`mod.rs` L167–217) |
| UI busy signals | `GalleryPage.tsx`: `fileOperation`, `unfavoriteBusy`, `fileOperationRef` |
| Entry UI | `src/app/App.tsx` → `GalleryPage` only |
| Tests gate | `npm run typecheck`, `npm test`, `npm run i18n-check`; `cargo test` file_ops |
| CI | `.github/workflows/release.yml` (new), `windows-latest` |

**Decisions (from spec, no re-research)**:

- Endpoint: `https://github.com/PavelKull/StitchVue/releases/latest/download/latest.json`
- `bundle.createUpdaterArtifacts: true`
- `plugins.updater.windows.installMode`: **`passive`**
- `allowDowngrades`: **false** (default / explicit in config)
- Download API: **`download()` + progress events + `install()`** (not silent `downloadAndInstall` without UI hook points)
- Update check: **once per app launch** after shell ready (CL-R02)
- FSD placement: **`src/features/app-update/`** (not inside gallery widgets)

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| No gallery/pipeline refactor | PASS | App-level feature; gallery touch ≤ 1 context hook |
| File ops invariants I6 | PASS | `claim`/`complete` unchanged; prepare only adds early reject |
| I7/I8 | VERIFY | Smoke T8–T9, N-14–N-15 after implementation |
| High-risk (CI secrets, updater) | PLAN | `docs/refactoring/tasks/` optional; human owns keygen |
| User consent | PASS | No download until «Обновить» |
| LICENSE before public Latest | HUMAN | Stage 0 |

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│ App.tsx                                                          │
│  └─ AppUpdateProvider (features/app-update)                      │
│       ├─ onMount: check() once                                   │
│       ├─ UpdateDialog (version, notes, Later / Update)           │
│       └─ useUpdateGate() ← optional register from GalleryPage    │
│            OR invoke-only gate (file op + prepare IPC)           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ @tauri-apps/plugin-updater
┌───────────────────────────▼─────────────────────────────────────┐
│ tauri-plugin-updater + tauri.conf.json (pubkey, endpoints)       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ NEW IPC: file_operation_in_progress                              │
│ NEW IPC: begin_app_update_prepare / end_app_update_prepare       │
│ file_ops::claim — if update_prepare → Claim::Busy (new ops only) │
└─────────────────────────────────────────────────────────────────┘

GitHub tag v* → release.yml → tauri-action → .exe + .sig + latest.json
```

### Updater lifecycle (frontend state machine)

States: `idle` → `checking` → `idle` | `offer` → (`dismissed` → close) | `arming` → `downloading` → `installing` → *(app exit)* | `error`.

| State | User-visible | Network / FS |
|-------|----------------|--------------|
| `checking` | none / subtle | `check()` |
| `offer` | Dialog | none |
| `dismissed` | closed | none |
| `arming` | «Подготовка…», Update disabled | `begin_app_update_prepare` |
| `downloading` | progress % | `download()` + listen progress |
| `installing` | «Установка…» | `install()` |
| `error` | message + retry | `end_app_update_prepare` on exit paths |

**Consent invariant**: transitions into `arming` only from explicit Update click (FR-REL-17, N-12 guarded by `arming` flag).

### Atomic file-op gate (race-safe prepare)

**Problem**: между UI «нет file op» и `download()` пользователь может начать delete/favorite batch.

**Solution** (minimal Rust change):

1. `static UPDATE_PREPARE: AtomicBool` in `file_ops/mod.rs`.
2. `pub fn begin_app_update_prepare() -> Result<(), String>`:
   - Lock registry; if `!active.is_empty()` → `Err("file_operation_in_progress")`.
   - Set `UPDATE_PREPARE = true`.
   - Re-check `active` (double-check under same lock).
   - Ok
3. At **start** of `claim()`: if `UPDATE_PREPARE` → return `Claim::Busy` (new ops blocked).
4. `pub fn end_app_update_prepare()` — clear flag (call on error, cancel, after install invoked, component unmount).
5. `pub fn any_file_operation_in_progress() -> bool` — `!active.is_empty()`.

**Frontend sequence on Update**:

```text
if (uiBusy || await invoke('file_operation_in_progress')) → show message (N-10, N-11)
await invoke('begin_app_update_prepare')  // fails if race
try { download + install }
finally { await invoke('end_app_update_prepare') }
```

**UI busy**: `useUpdateGate({ fileOp: fileOperation !== null, unfavoriteBusy })` exported from `app-update`, registered from `GalleryPage` via single line `<UpdateGateRegistrar ... />` or context — **only** passes booleans, no gallery logic change.

**Does NOT**: cancel in-flight ops; block pipeline/indexing (out of scope unless they hold file locks — they don't use `claim`).

---

## Test vs Public Releases

| Aspect | Test / prerelease | Public |
|--------|-------------------|--------|
| Tag pattern | `v*-test.*` or `v0.1.100-test.N` | `v1.0.0`, `v1.0.1`, … |
| GitHub Release | `prerelease: true`, **not** Latest | `latest: true` |
| Endpoint for dev builds | Optional second endpoint via env (dev only) — **production app uses single GitHub latest URL** | `releases/latest/download/latest.json` |
| CI job input | `workflow_dispatch` + `prerelease: true` | tag push `v*` without `-test` |
| Human gate | T1–T11 | LICENSE + SC-REL-007 |

**CI safeguard (N-16)**: job step `if secrets.TAURI_SIGNING_PRIVATE_KEY == ''` → `exit 1` for release publish jobs.

**Artifact verification** (Stage 8): script `scripts/verify-release-assets.mjs` (read-only HTTP): fetch `latest.json`, validate JSON schema, download `.exe` size > 0, optional minisign verify if `minisign` on runner (document manual verify on maintainer machine).

---

## Signing Key Storage & Backup (no keygen in repo)

Document in `docs/release/SIGNING.md` (Stage 1):

| Store | Content |
|-------|---------|
| Git repo | **Public** key only (`tauri.conf.json` → `plugins.updater.pubkey`) |
| GitHub Secrets | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Maintainer offline | Password manager or encrypted USB; **two** backup copies; rotation procedure |
| Never | `.env`, git, screenshots, chat logs |

Recovery: new key pair → bump pubkey in app → all future releases signed with new key; users on old builds need manual install once (document in RELEASING.md).

---

## Implementation Phases

Каждый этап — отдельный PR или commit batch; **verify** перед следующим.

### Stage 0 — License & release docs (human + docs only)

| | |
|--|--|
| **Files** | `LICENSE` (owner), `docs/release/RELEASING.md`, `docs/release/SIGNING.md` |
| **Deps** | None |
| **Tests** | Manual: LICENSE exists |
| **Done when** | RELEASING checklist covers version bump (package.json, Cargo.toml, tauri.conf.json), tag, T1–T11, public Latest gate (N-17) |

---

### Stage 1 — File-operation probe & update prepare gate (Rust only)

| | |
|--|--|
| **Files** | `src-tauri/src/file_ops/mod.rs` (UPDATE_PREPARE, `any_file_operation_in_progress`, `begin/end_app_update_prepare`, `claim` early check); `src-tauri/src/commands/mod.rs` (3 commands); `src-tauri/src/lib.rs` (register); `docs/IPC.md` |
| **Deps** | None |
| **Tests** | **New** `src-tauri/src/file_ops/update_gate.rs` or `#[cfg(test)]` in mod: (1) prepare blocks new claim; (2) active op blocks prepare; (3) end clears prepare; (4) existing `file_ops` tests still pass |
| **Commands** | `file_operation_in_progress`, `begin_app_update_prepare`, `end_app_update_prepare` |
| **Done when** | `cargo test file_ops` pass; IPC doc updated; **no** frontend change |

**Negative coverage**: N-10 backend half; race test: thread holds claim while prepare → Err.

---

### Stage 2 — Tauri updater backend config (no UI)

| | |
|--|--|
| **Files** | `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json` |
| **Deps** | `tauri-plugin-updater = "2.12.0"` |
| **Config** | `createUpdaterArtifacts: true`, `plugins.updater.endpoints`, `pubkey` placeholder until key exists (use test pubkey from signer generate step — human pastes), `allowDowngrades: false` |
| **Tests** | `cargo check`; `npm run tauri build` (local, may lack sig) |
| **Done when** | Release build succeeds; updater plugin loads on Windows dev |

**Note**: pubkey can be committed before private key lands in Secrets.

---

### Stage 3 — Frontend updater module (no Gallery wire)

| | |
|--|--|
| **Files** | `package.json`; `src/features/app-update/` — `model/useAppUpdate.ts`, `ui/UpdateDialog.tsx`, `ui/UpdateDialog.module.scss`, `lib/updateGate.ts`, `api/updater.ts`, `index.ts` |
| **Deps** | `@tauri-apps/plugin-updater@2.12.0` |
| **Tests** | **New** `src/features/app-update/lib/updateLifecycle.test.ts` — state machine: no download without confirm; double Update ignored (N-12); mock plugin |
| **Done when** | typecheck pass; unit tests pass; module not mounted in App yet |

**API surface** (`updater.ts`): `checkForUpdate`, `downloadUpdateWithProgress(onProgress)`, `installUpdate` — wrap plugin, map errors to i18n keys.

---

### Stage 4 — App integration & i18n

| | |
|--|--|
| **Files** | `src/app/App.tsx` (wrap provider + dialog); `src/pages/gallery/GalleryPage.tsx` (**minimal**: import `useRegisterUpdateGate(fileOperation, unfavoriteBusy)` one hook call); `src/shared/i18n/locales/{ru,en,de,zh-Hans}.json`; `README.md` (updater available) |
| **Deps** | Stage 3 |
| **Tests** | `npm test`, `npm run i18n-check` |
| **Done when** | Manual dev: `tauri dev` + mock endpoint (see quickstart) shows dialog; «Позже» no download (N-04–N-09 manual later) |

**Negative mapping**: N-01–N-03 silent fail in `check()` catch; N-05–N-08 in error state; N-22 no auto path to `arming`.

---

### Stage 5 — GitHub Actions (test channel first)

| | |
|--|--|
| **Files** | `.github/workflows/release.yml`; optional `.github/workflows/ci.yml` (typecheck+test only, no release) |
| **Deps** | Secrets configured by human |
| **Workflow** | `workflow_dispatch` inputs: `version_tag`, `prerelease` (default true for first runs); on tag `v*`: build; `tauri-action` with `releaseDraft: true` initially |
| **Tests** | Push tag `v0.1.100-test.1` on branch → artifacts present |
| **Done when** | Release contains exe + sig + latest.json; N-16 enforced |

---

### Stage 6 — CI quality gate

| | |
|--|--|
| **Files** | `.github/workflows/ci.yml` or `release.yml` job `test` |
| **Steps** | `npm ci`, typecheck, npm test, i18n-check |
| **Done when** | PRs run tests (SC-REL-005) |

---

### Stage 7 — Artifact verification tooling

| | |
|--|--|
| **Files** | `scripts/verify-release-assets.mjs`; section in `RELEASING.md` |
| **Checks** | HTTP GET latest.json; required keys; URL returns 200; signature field non-empty; version matches tag |
| **Done when** | Script exits 0 against test release; documents T11 manual tamper test |

---

### Stage 8 — Two-version VM validation (T1–T11)

| | |
|--|--|
| **Human** | Install test.1 → data → publish test.2 → T5–T11 |
| **Maps** | SC-REL-003, SC-REL-004, SC-REL-006, N-05, N-10, N-14, N-15 |
| **Done when** | Checklist signed in `docs/release/` or issue |

---

### Stage 9 — Public release `v1.0.0` (human)

| | |
|--|--|
| **Pre** | LICENSE, T1–T11 pass, README, draft → Latest |
| **Post smoke** | FR-REL-29 gallery smoke; file_ops tests green |

---

## Negative Scenario → Stage Map

| ID | Primary verification |
|----|----------------------|
| N-01–N-03 | Stage 4 manual + error handling in `useAppUpdate` |
| N-04 | Stage 4 unit + manual |
| N-05–N-06 | Stage 8 T11 / plugin rejects |
| N-07–N-09 | Stage 4 error UI + Stage 8 |
| N-10–N-11 | Stage 1 + 4 gate |
| N-12 | Stage 3 unit test |
| N-13 | Documented; Tauri behavior |
| N-14–N-15 | Stage 8 T8–T9 |
| N-16 | Stage 5 workflow |
| N-17 | Stage 0 human |

---

## Files Touched (consolidated)

| Path | Stages |
|------|--------|
| `src-tauri/src/file_ops/mod.rs` | 1 |
| `src-tauri/src/commands/mod.rs`, `lib.rs` | 1, 2 |
| `src-tauri/tauri.conf.json`, `capabilities/default.json`, `Cargo.toml` | 2 |
| `src/features/app-update/**` | 3–4 |
| `src/app/App.tsx` | 4 |
| `src/pages/gallery/GalleryPage.tsx` | 4 (1 hook) |
| `package.json` | 2–3 |
| `.github/workflows/*.yml` | 5–6 |
| `docs/release/RELEASING.md`, `SIGNING.md` | 0, 7 |
| `docs/IPC.md` | 1 |
| `scripts/verify-release-assets.mjs` | 7 |
| `README.md`, `LICENSE` | 0, 4, 9 |

**Explicitly not touched**: `src-tauri/src/pipeline/`, `file_ops` execute/copy/move, `StitchVueGrid.tsx`, thumbnail modules, SQLite migrations.

---

## Agent Execution Notes

| Agent | Stages |
|-------|--------|
| **backend-executor** | 1, 2 (Rust IPC, tauri.conf, capabilities) |
| **frontend-executor** | 3, 4 (app-update FSD, App.tsx, i18n, GalleryPage hook) |
| **generalPurpose / human** | 0, 5 secrets, 8–9 VM |
| **regression-guardian** | After 4 and 8 |

Each task file in `docs/refactoring/tasks/` should cite `allowed_paths` from table above.

---

## Post-Design Constitution Re-check

| Item | Result |
|------|--------|
| Minimal IPC | 3 commands only |
| No auto install | State machine enforced |
| Data safety | NSIS upgrades install dir only; CL-R04 documented |
| Test/public split | prerelease + draft workflow |

---

## Related Artifacts

- [`research.md`](./research.md) — decision log
- [`data-model.md`](./data-model.md) — entities & state
- [`quickstart.md`](./quickstart.md) — maintainer & developer
- [`contracts/ipc.md`](./contracts/ipc.md) — new commands
- [`contracts/release-artifacts.md`](./contracts/release-artifacts.md) — CI outputs

**Next command**: `/speckit-tasks` → `tasks.md` ordered by stages above.
