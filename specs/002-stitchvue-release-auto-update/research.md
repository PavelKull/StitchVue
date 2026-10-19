# Research & Decisions: stitchvue-release-auto-update

**Date**: 2026-10-17  
**Source**: [`spec.md`](./spec.md), [`docs/release/RELEASE_FOUNDATION_REPORT.md`](../../docs/release/RELEASE_FOUNDATION_REPORT.md)

No new external research performed; decisions locked for implementation.

## D-01 Updater package versions

Pin `tauri-plugin-updater` and `@tauri-apps/plugin-updater` to **2.12.0** with core Tauri **2.12.1**.

## D-02 GitHub endpoint

Production: `https://github.com/PavelKull/StitchVue/releases/latest/download/latest.json`  
Platform key: `windows-x86_64` (NSIS-only).

## D-03 installMode

`passive` — NSIS minimal UI during in-app update (Tauri default recommendation).

## D-04 Download API shape

Use `check()` → user confirm → `begin_app_update_prepare()` → `download()` with progress listener → `install()` → `end_app_update_prepare()` in `finally`. Avoid blind `downloadAndInstall()` to preserve consent and gate hooks.

## D-05 Update check timing

Once per launch after `App` mount + `requestAnimationFrame` or short `setTimeout(0)` so window paints; not on interval (CL-R02).

## D-06 FSD location

`src/features/app-update/` — keeps gallery/page free of updater UI.

## D-07 Gallery integration surface

Single hook `useRegisterUpdateGate({ fileOperationActive, unfavoriteBusy })` in `GalleryPage.tsx`; no changes to selection coordinator or file op IPC.

## D-08 Race prevention

`UPDATE_PREPARE` atomic + `claim()` rejects new ops; double-check `active` map empty before arming; UI busy as fast-path only.

## D-09 Test vs public releases

Prerelease GitHub Releases for `*-test*` tags; public Latest only after LICENSE + T1–T11.

## D-10 CI signing

Fail publish if `TAURI_SIGNING_PRIVATE_KEY` missing (N-16). Local dev builds unsigned OK.

## D-11 Dev endpoint override

Optional `TAURI_UPDATER_ENDPOINT` at **build time** only for fork testing — not shipped in production config (production endpoints fixed in `tauri.conf.json`).

## D-12 allowDowngrades

`false` in `plugins.updater` (N-06).
