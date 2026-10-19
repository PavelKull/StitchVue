# Contract: GitHub Release artifacts

**Workflow**: `.github/workflows/release.yml`  
**Action**: `tauri-apps/tauri-action@v1` (pin minor version in implementation)

## Required assets per release tag

| Asset | Required | Used by |
|-------|----------|---------|
| `StitchVue_<version>_x64-setup.exe` | yes | Manual install + updater download URL |
| `StitchVue_<version>_x64-setup.exe.sig` | yes (signed releases) | `latest.json` signature field |
| `latest.json` | yes | Updater endpoint |

## Workflow inputs

| Input | Purpose |
|-------|---------|
| `workflow_dispatch.prerelease` | `true` for test tags |
| Tag filter `v*` | Production + test tags |

## Environment variables (secrets)

| Name | Required on publish |
|------|---------------------|
| `GITHUB_TOKEN` | yes |
| `TAURI_SIGNING_PRIVATE_KEY` | yes (N-16) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | if key encrypted |

## `tauri-action` expectations

- `uploadUpdaterJson: true` (default)  
- `uploadUpdaterSignatures: true` (default)  
- Release marked **prerelease** when tag matches `*-test*` or workflow input  
- **Latest** only for public tags after human promotion  

## Verification script contract (`scripts/verify-release-assets.mjs`)

**Args**: `--tag vX.Y.Z` or `--url <latest.json url>`

**Asserts**:

1. HTTP 200 for `latest.json`  
2. `version` matches tag (normalized)  
3. `platforms.windows-x86_64.url` HTTP 200, `content-length` > 1_000_000  
4. `signature` non-empty string  
5. Optional: warn if Release is Latest but tag contains `test`

## Negative tests

| ID | Contract check |
|----|----------------|
| N-05 | Wrong signature → updater rejects (manual T11) |
| N-16 | Missing secret → workflow fails before upload |
