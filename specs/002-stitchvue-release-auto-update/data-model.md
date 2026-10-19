# Data Model: stitchvue-release-auto-update

## Release (CI / GitHub)

| Field | Type | Notes |
|-------|------|-------|
| `tag` | string | `vX.Y.Z` or `v0.1.100-test.N` |
| `version` | semver string | Matches tag without `v` |
| `prerelease` | boolean | Test channel when true |
| `isLatest` | boolean | Only one public Latest |
| `notes` | markdown | GitHub Release body → `latest.json.notes` |
| `assets.exe` | file | `StitchVue_{version}_x64-setup.exe` |
| `assets.sig` | text | Minisign signature body |
| `assets.latestJson` | json | Tauri static format |

### latest.json (logical)

```json
{
  "version": "1.0.1",
  "notes": "…",
  "pub_date": "ISO-8601",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/.../StitchVue_1.0.1_x64-setup.exe",
      "signature": "<contents of .sig>"
    }
  }
}
```

## UpdateOffer (from plugin `check()`)

| Field | Source |
|-------|--------|
| `version` | Remote |
| `currentVersion` | Installed |
| `body` / notes | `Update.notes` or `update.rawJson` |
| `date` | optional `pub_date` |

## UpdateSession (frontend)

| State | Transitions in |
|-------|----------------|
| `idle` | initial, after dismiss/error cleanup |
| `checking` | app start |
| `offer` | update available |
| `arming` | Update clicked, prepare IPC |
| `downloading` | `download()` |
| `installing` | `install()` |
| `error` | any failure |

**Invariant**: `downloading` reachable only from `arming` after successful `begin_app_update_prepare`.

## FileBusyGate (composite)

| Signal | Source |
|--------|--------|
| `uiFileOp` | `fileOperation !== null` |
| `uiUnfavorite` | `unfavoriteBusy` |
| `rustActive` | `file_operation_in_progress()` |
| `prepareArmed` | after `begin_app_update_prepare` until `end` |

`canStartUpdate = !uiFileOp && !uiUnfavorite && !rustActive` (UI); install path also requires successful prepare.

## Signing keys

| Entity | Storage |
|--------|---------|
| `UpdaterPublicKey` | `tauri.conf.json` |
| `UpdaterPrivateKey` | GitHub Secret + offline backup |
| `KeyBackup` | Human procedure in SIGNING.md |

## Persistent user data (unchanged by feature)

| Entity | Path |
|--------|------|
| `AppDatabase` | `%LOCALAPPDATA%\StitchVue\stitchvue.db` |
| `ThumbnailCache` | `%LOCALAPPDATA%\StitchVue\cache\` |
| `UiPreferences` | existing localStorage keys |
| `UserPhotos` | user-selected directories (read-only for updater) |
