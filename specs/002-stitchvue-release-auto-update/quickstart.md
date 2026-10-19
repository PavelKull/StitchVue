# Quickstart: stitchvue-release-auto-update

## Maintainer — first-time signing (human, out of band)

1. Install Tauri CLI 2.12.x locally.
2. Run `tauri signer generate -w <path-outside-repo>/stitchvue.key` (password optional).
3. Copy **public** key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
4. Add **private** key to GitHub repo → Settings → Secrets → `TAURI_SIGNING_PRIVATE_KEY` (+ password secret if used).
5. Store encrypted backup of private key in two offline locations (`docs/release/SIGNING.md`).

## Maintainer — test release (T1–T11)

1. Bump version to `0.1.100-test.1` in `package.json`, `Cargo.toml`, `tauri.conf.json`.
2. Commit; tag `v0.1.100-test.1`; push tag.
3. Run `release` workflow (or tag trigger); confirm prerelease assets.
4. Run `node scripts/verify-release-assets.mjs --tag v0.1.100-test.1` (after Stage 7).
5. Install NSIS on VM; complete T1–T6.
6. Bump to `test.2`, tag, repeat; complete T7–T11.

## Maintainer — public v1.0.0

1. Confirm `LICENSE` in repo root.
2. T1–T11 signed off.
3. Bump `1.0.0`, changelog, tag `v1.0.0`, publish Release as **Latest** (not draft).
4. README states in-app updates enabled.

## Developer — local app without signed updates

```text
npm install
npm run tauri dev
```

Updater `check()` may fail or find nothing — expected without published release.

## Developer — test update UI against prerelease

1. Build and install older test tag from CI.
2. Publish newer prerelease with signed `latest.json`.
3. Ensure installed app version < remote; restart app.

**Do not** point production `tauri.conf.json` at non-GitHub HTTP endpoints.

## Verification commands (each stage)

```text
npm run typecheck
npm test
npm run i18n-check
cd src-tauri && cargo test file_ops --
npm run tauri build
```
