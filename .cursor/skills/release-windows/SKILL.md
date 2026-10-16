---
name: release-windows
description: Runs the StitchVue Windows release checklist from clean build through install and uninstall. Use when the user asks for a production build, installer, Setup.exe, or Stage 16 release.
---

# Release Windows

Do not start this skill before the app builds and the stage-level checks pass. Follow `security-review` first when this is a release candidate.

```text
clean build → tests → production build → installer → fresh install → startup → open folder → cache → uninstall
```

## Verify on a machine

- `StitchVue Setup.exe` installs
- Start menu or desktop shortcut launches the app
- First startup shows a window in under the spec's startup goal when measured
- Open a folder of images; placeholders appear before thumbnail generation finishes
- Cache and `stitchvue.db` appear under `%LOCALAPPDATA%\StitchVue\`, not next to the photos
- Uninstall removes the app. Note whether the cache is left behind, and match whatever the spec or installer says

## Record

Write the installer path, OS build, and pass/fail of each step into `документация-проекта/TODO.md` or `документация-проекта/PERFORMANCE.md`. Do not claim a step passed if it was not run.
