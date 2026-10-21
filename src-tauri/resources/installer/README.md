# NSIS installer branding

Assets used by Tauri `bundle.windows.nsis` (see `src-tauri/tauri.conf.json`).

| File | Role | Size |
|------|------|------|
| `source-welcome.png` | Original artwork (do not edit) | 768×1024 |
| `installer-welcome.bmp` | Welcome / Finish sidebar | 164×314, 24-bit BMP |
| `installer-header.bmp` | Page header strip | 150×57, 24-bit BMP |
| `preview-*.png` | Review copies of the BMPs | same pixels |

Icons: `src-tauri/icons/icon.ico` (installer + uninstaller).

To refresh BMPs after changing the source, regenerate at the recommended NSIS sizes **without stretching** (crop then scale). Keep `source-welcome.png` unchanged.
