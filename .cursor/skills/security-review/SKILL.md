---
name: security-review
description: Reviews StitchVue for path traversal, Tauri capabilities, and unsafe file or SQL handling before release. Use when the user asks for a security review, release readiness, or when changing filesystem commands, capabilities, or SQLite queries.
---

# Security review

Desktop app, local files, no account system. Still treat every path and SQL value as user-controlled.

## Check

- Tauri capabilities allow only the commands the UI needs
- Commands reject paths that escape the picked folder or the app cache root (`..`, prefix tricks, NTFS alternate streams if handled)
- The scanner and viewer cannot be pointed at arbitrary system paths unless the user picked that folder
- Cache writes stay under `%LOCALAPPDATA%\StitchVue\`
- User photo folders are not modified, renamed, or deleted
- SQLite uses bound parameters; table names are not concatenated from input
- Thumbnail and original paths from the database are rechecked before read
- No shell launch built from a raw path
- `unsafe` and raw filesystem flags are justified next to the block
- External or partial files (truncated JPEG, huge dimensions) fail the decode without panicking the process

## Result

```text
Path rules:
Capabilities:
SQL:
User-folder writes:
```

Severity: `block-release` or `fix-later`. Do not rewrite the feature during the review.
