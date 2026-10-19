# StitchVue — Production Release Readiness Audit

**Дата:** 2026-10-17  
**Режим:** read-only (исходный код, конфиги и зависимости не менялись).  
**Артефакт:** этот файл создан по ТЗ аудита.

**Цели релиза (из ТЗ):** Windows EXE-установщик; install/uninstall; проверка новых версий; уведомление; обновление только с согласия; сохранение пользовательских данных и фотографий при обновлении.

---

## 1. Общий вердикт

**BLOCKED**

Приложение технически ориентировано на Windows NSIS-бандл и хранит служебные данные в `%LOCALAPPDATA%\StitchVue\`, не смешивая их с каталогами фотографий пользователя. Однако **контур автообновлений не реализован**, **нет CI/CD для GitHub Releases**, **нет LICENSE**, **нет документации выпуска**, **production-сборка установщика в рамках аудита не проверялась**, а **публичные ссылки GitHub в приложении пустые**. Первый публичный релиз с заявленными целями 3–6 невозможен без отдельной реализации и инфраструктуры.

---

## 2. Таблица проверок

| ID | Область | Проверка | Результат |
|----|---------|----------|-----------|
| T1 | Tauri | Версии Tauri 2 / CLI / lockfile согласованы | **PASS** |
| T2 | Tauri | `identifier` + `version` в конфиге | **PASS** |
| T3 | Tauri | NSIS target, без MSI | **PASS** (только NSIS) |
| T4 | Tauri | Иконки Windows для bundle | **PASS** (файлы в репозитории) |
| T5 | Tauri | NSIS install/uninstall/reinstall кастомизация | **UNVERIFIED** (дефолты Tauri) |
| T6 | Tauri | WebView2 bootstrap на чистой ОС | **UNVERIFIED** (нет `webviewInstallMode` в конфиге) |
| T7 | Tauri | Capabilities / поверхность IPC | **PASS** (минимальные permissions) |
| T8 | Tauri | Запуск без Node/Rust у конечного пользователя | **PASS** (теория бандла); **NOT TESTED** (installer) |
| T9 | Данные | Служебные данные в `%LOCALAPPDATA%\StitchVue\` | **PASS** |
| T10 | Данные | Установка/удаление не трогают каталоги фото | **PASS** (архитектура); uninstall cache — **UNVERIFIED** |
| T11 | Данные | Файловые операции (trash/favorites/recycle) | **PASS** (код + тесты); I7/I8 — **UNVERIFIED** |
| T12 | Обновления | Tauri Updater plugin | **FAIL** (отсутствует) |
| T13 | Обновления | UI «Обновить» / «Позже» | **FAIL** |
| T14 | Обновления | Подпись + `latest.json` + GitHub endpoint | **FAIL** |
| T15 | GitHub | Actions / release workflow | **FAIL** |
| T16 | GitHub | LICENSE | **FAIL** |
| T17 | GitHub | README / release docs | **PARTIAL** |
| T18 | GitHub | Секреты в репозитории | **PASS** (выборочный grep); email в конфиге — см. P1 |
| T19 | CI | Автосборка Windows EXE | **FAIL** |
| T20 | Версии | `0.1.0` согласованы | **PASS** |
| T21 | Качество | `npm run typecheck` | **PASS** (выполнено) |
| T22 | Качество | `npm test` | **PASS** (424 теста) |
| T23 | Качество | `cargo test` file_ops | **PASS** (110 тестов) |
| T24 | Качество | ESLint | **FAIL** (нет конфигурации в репозитории) |
| T25 | Качество | `npm run tauri build` / installer | **NOT TESTED** (по ограничению ТЗ) |

---

## 3. Критические блокеры (P0)

### P0-1 — Автообновления не реализованы

| | |
|---|---|
| **Файлы** | `src-tauri/Cargo.toml` (только `tauri`, `tauri-plugin-dialog`); `src-tauri/src/lib.rs` (нет updater plugin); `src-tauri/tauri.conf.json` (нет секции `plugins`/updater); поиск по репозиторию: нет `tauri-plugin-updater`, `latest.json`. |
| **Причина** | Контур обновлений отсутствует в зависимостях, конфигурации и UI. |
| **Последствия** | Цели ТЗ 3–5 невыполнимы; нельзя безопасно доставлять патчи пользователям. |
| **Минимальное исправление** | Добавить `tauri-plugin-updater`, настроить `tauri.conf.json` (pubkey, endpoints GitHub Releases), UI с явным согласием, подпись артефактов в CI. |
| **Проверка** | Релиз с тестовым тегом; приложение видит новую версию; без клика «Обновить» установка не начинается. |

### P0-2 — Нет CI/CD для GitHub Releases

| | |
|---|---|
| **Файлы** | Отсутствует каталог `.github/workflows/` в репозитории. |
| **Причина** | Нет автоматической сборки `*-setup.exe`, загрузки в Releases, генерации updater-метаданных. |
| **Последствия** | Пользователи не могут стабильно «скачать EXE с GitHub» без ручной сборки на машине разработчика. |
| **Минимальное исправление** | Workflow: `npm ci` → `npm run build` → `npm run tauri build` на `windows-latest`, публикация NSIS + подписанных `.sig` + `latest.json`. |
| **Проверка** | Push tag `v0.1.1` создаёт Release с артефактами. |

### P0-3 — Отсутствует LICENSE

| | |
|---|---|
| **Файлы** | В корне репозитория нет `LICENSE` / `LICENSE.md` (поиск по `LICENSE*`). |
| **Причина** | Правовой статус кода для публичного GitHub не определён. |
| **Последствия** | Блокер публичной публикации для сторонних пользователей и дистрибуции. |
| **Минимальное исправление** | Добавить выбранную лицензию (MIT/Apache-2.0 и т.д.) в корень; при необходимости `NOTICE` для зависимостей. |
| **Проверка** | GitHub отображает license; README ссылается на файл. |

### P0-4 — Production installer не верифицирован

| | |
|---|---|
| **Файлы** | `package.json` (`"tauri": "tauri"`); `docs/DEVELOPMENT.md` (только `tauri dev`, без release). |
| **Причина** | В рамках аудита `npm run tauri build` не запускался (побочные эффекты / ограничение ТЗ). |
| **Последствия** | Нельзя подтвердить, что `StitchVue_*_x64-setup.exe` собирается и устанавливается на чистой Windows. |
| **Минимальное исправление** | Прогнать чеклист `.cursor/skills/release-windows/SKILL.md` на VM/чистой машине. |
| **Проверка** | Install → launch → open folder → uninstall; зафиксировать путь к EXE и OS build. |

---

## 4. Важные проблемы (P1)

### P1-1 — Пустой URL репозитория GitHub в приложении

| | |
|---|---|
| **Файлы** | `src/shared/external-links.json` (`"githubRepo": ""`); `src-tauri/src/commands/mod.rs` (`external_link_field` → ошибка при пустом URL); `open_external_link` для `GithubRepo` / `GithubIssues`. |
| **Причина** | Поле не заполнено перед публикацией. |
| **Последствия** | Кнопки «GitHub» / «Сообщить о проблеме» в настройках падают с ошибкой после релиза. |
| **Минимальное исправление** | Указать `https://github.com/<org>/StitchVue` в `external-links.json` (и синхронность с `include_str` в Rust уже обеспечена комментарием). |
| **Проверка** | Открыть настройки → ссылки открывают браузер на корректный repo/issues. |

### P1-2 — Нет документации выпуска версии

| | |
|---|---|
| **Файлы** | `README.md`, `docs/DEVELOPMENT.md` — нет раздела release/tag/signing; skill `release-windows` есть, но не привязан к `docs/release/`. |
| **Причина** | Процесс bump версий, тегов, ключей подписи не описан. |
| **Последствия** | Риск рассинхрона `package.json` / `Cargo.toml` / `tauri.conf.json` / Git tag. |
| **Минимальное исправление** | `docs/release/RELEASING.md`: bump → test → tag → CI → smoke. |
| **Проверка** | Dry-run по документу на patch-релизе. |

### P1-3 — Инварианты I7/I8 остаются UNVERIFIED на уровне продукта

| | |
|---|---|
| **Файлы** | `docs/INVARIANTS.md` (I7, I8 — UNVERIFIED); `src-tauri/src/file_ops/mod.rs` (`Action` только move→локальная корзина, copy→избранное). |
| **Причина** | Широкое покрытие unit-тестов не заменяет формальное закрытие инвариантов для всего контура. |
| **Последствия** | Риск ложного успеха UI/БД или неожиданного воздействия на оригиналы в edge-кейсах (см. `docs/audit/favorites/GAP_ANALYSIS.md`). |
| **Минимальное исправление** | Ручной smoke из `docs/INVARIANTS.md` + точечные high-risk тесты перед релизом. |
| **Проверка** | Заполненный чеклист smoke с датой и билдом. |

### P1-4 — CSP отключён (`null`)

| | |
|---|---|
| **Файлы** | `src-tauri/tauri.conf.json` → `"security": { "csp": null }`. |
| **Причина** | Явное отключение CSP в конфиге Tauri 2. |
| **Последствия** | Расширенная поверхность для XSS в WebView при появлении инъекций в UI/контенте. |
| **Минимальное исправление** | Ужесточить CSP для production-сборки (без ломания `asset://` / dev). |
| **Проверка** | Smoke UI + viewer; security-review skill. |

### P1-5 — Персональные контакты в отслеживаемом конфиге

| | |
|---|---|
| **Файлы** | `src/shared/external-links.json` (`supportEmail`, donation URLs). |
| **Причина** | Данные закоммичены в репозиторий (не секрет, но PII/спам-риск). |
| **Последствия** | Публичный GitHub раскрывает email и платёжные ссылки. |
| **Минимальное исправление** | Осознанное решение: оставить / заменить на GitHub Issues only / вынести в release-only config. |
| **Проверка** | Review перед `git push --public`. |

### P1-6 — `.gitignore` не игнорирует `src-tauri/target/`

| | |
|---|---|
| **Файлы** | `.gitignore` (нет `target/`); в git status видны артефакты `src-tauri/target/`. |
| **Причина** | Локальные сборки попадают в статус; риск случайного коммита бинарников. |
| **Последствия** | Загрязнение репозитория, утечка путей машины разработчика. |
| **Минимальное исправление** | Добавить `src-tauri/target/`. |
| **Проверка** | `git status` чист после `cargo build`. |

---

## 5. Необязательные улучшения (P2)

| ID | Тема | Основание | Рекомендация |
|----|------|-----------|--------------|
| P2-1 | MSI | `tauri.conf.json` → `"targets": ["nsis"]` only | MSI не нужен, если достаточно NSIS EXE. |
| P2-2 | Дублирование иконок | `icons/stitchvue/StitchVue.ico` vs `icons/icon.ico` | Унифицировать источник; README в `icons/stitchvue/`. |
| P2-3 | `icons/__pycache__` в git | `git ls-files` | Удалить из индекса, добавить в `.gitignore`. |
| P2-4 | ESLint в gate | Нет `eslint.config.*` | Добавить минимальный lint в CI (не блокер функционала). |
| P2-5 | Политика uninstall для cache | Skill release-windows: «Note whether cache is left behind» | Документировать: uninstall оставляет `%LOCALAPPDATA%\StitchVue\` (ожидаемо для сохранения данных). |
| P2-6 | E2E Tauri IPC | `docs/audit/favorites/AUDIT_SUMMARY.md` | Интеграционные тесты favorites IPC. |

---

## 6. Уже реализованные возможности

- **Tauri 2 desktop app:** `tauri` 2.12.1 (`Cargo.lock`), `@tauri-apps/cli` 2.12.1 (`package-lock.json`), Rust **1.96.0** (локально при аудите).
- **Windows NSIS bundle:** `src-tauri/tauri.conf.json` — `bundle.active: true`, `targets: ["nsis"]`, `identifier: "com.stitchvue.app"`, `version: "0.1.0"`.
- **Иконки:** `src-tauri/icons/icon.ico`, `32x32.png`, `128x128.png`, … — присутствуют в git и на диске.
- **Пользовательские данные приложения:** `src-tauri/src/database/mod.rs` → `%LOCALAPPDATA%\StitchVue\`, `stitchvue.db`, cache thumbnails; `tauri.conf.json` → `assetProtocol.scope` `$LOCALDATA/StitchVue/**`.
- **Фотографии пользователя:** хранятся в выбранных каталогах; `Action` в `file_ops/mod.rs` не включает «удалить оригинал с диска» вне move/copy в сервисные папки.
- **Файловые операции:** claim/replay/busy (`commands/mod.rs` + `file_ops`); журнал и `reconcile_on_boot` (`reconcile.rs`, вызов из `pipeline/mod.rs`); Windows recycle (`recycle.rs`); обширные Rust-тесты (110 в `file_ops`).
- **Минимальные capabilities:** `src-tauri/capabilities/default.json` — `core:default`, fullscreen, `dialog:allow-open` (нет широкого `fs:default`).
- **Внешние ссылки с валидацией:** только `https://` для repo (`commands/mod.rs`); mailto валидируется для support.
- **Автотесты frontend:** 424 passed (`npm test`, 2026-10-17).
- **Typecheck:** `npm run typecheck` — OK.
- **i18n-check:** OK (390 keys).
- **Версии согласованы:** `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json` → `0.1.0`.
- **`.gitignore` для секретов:** `.env`, `*.pem`, `*.key`, `credentials.json`, `**/mcp.json`.

---

## 7. Отсутствующие компоненты

| Компонент | Статус |
|-----------|--------|
| `tauri-plugin-updater` + конфиг pubkey/endpoints | Отсутствует |
| UI проверки версии / диалог согласия / прогресс скачивания | Отсутствует |
| Подпись обновлений (minisign / Tauri signing) + секреты в CI | Отсутствует |
| `latest.json` (или эквивалент Tauri 2) | Отсутствует |
| GitHub Actions (build, release, artifacts) | Отсутствует |
| LICENSE | Отсутствует |
| `docs/release/RELEASING.md` (до этого аудита) | Отсутствовал |
| ESLint / pre-commit hooks в репозитории | Отсутствует |
| Заполненный `githubRepo` | Пустая строка |
| Гейт «не обновлять во время file operation» | Нет кода (нет updater) |

---

## 8. Минимальный план выхода на первый публичный релиз

**Фаза A — «Скачать и установить» (без автообновления, быстрый путь)**

1. LICENSE + заполнить `githubRepo` + README (download from Releases, системные требования WebView2).
2. Добавить `src-tauri/target/` в `.gitignore`; убрать `__pycache__` из icons из git.
3. Локально или в CI: `npm ci && npm run build && npm run tauri build` → опубликовать **один** NSIS EXE вручную или через минимальный workflow `workflow_dispatch`.
4. Ручной smoke: install / launch / folder / cache path / uninstall (skill `release-windows`).
5. Закрыть smoke-чеклист I7/I8 на критичных сценариях (delete→локальная корзина, favorite copy, restore).

**Фаза B — цели 3–6 (обновления)**

6. Сгенерировать ключи подписи updater (хранить private key только в CI secrets).
7. Подключить `tauri-plugin-updater` + frontend диалог (Update / Later) + обработка ошибок сети.
8. CI: на tag — build, sign, upload `.exe` + `.exe.sig`, generate `latest.json`.
9. Документировать: обновление не трогает `%LOCALAPPDATA%\StitchVue\` и не трогает каталоги фото (только бинарь приложения).
10. Опционально: блокировать «Установить» при активном `run_file_operation` (подписка на pipeline / флаг busy).

---

## 9. План внедрения обновлений (целевая архитектура)

```text
Git tag vX.Y.Z
  → GitHub Actions (windows-latest)
      → npm ci / npm run build
      → npm run tauri build -- --target x86_64-pc-windows-msvc
      → sign bundle (TAURI_PRIVATE_KEY / CI secret)
      → upload: StitchVue_X.Y.Z_x64-setup.exe + .sig
      → generate latest.json (version, notes, pub_date, platforms.windows.signature + url)
  → App startup (or periodic check)
      → @tauri-apps/plugin-updater check()
      → if update && !dismissed → modal (Update / Later)
      → on Update → download with progress → install() → relaunch
      → LOCALAPPDATA\StitchVue\ untouched (same user data)
```

**Согласие пользователя:** не вызывать `downloadAndInstall` / `install` до явного действия в UI (требование ТЗ; сейчас **нет кода** — при внедрении зафиксировать в тесте или manual checklist).

**Сохранение данных:** SQLite и cache в `database::app_dir()` — вне каталога установки NSIS; поведение при uninstall/install **не удаляет** эту папку по умолчанию (стандарт Windows + отсутствие custom NSIS hook в репозитории) — **UNVERIFIED** до ручного uninstall-теста.

---

## 10. Проверки, требующие ручного тестирования

| # | Сценарий | Почему не автоматизировано в аудите |
|---|----------|-------------------------------------|
| M1 | Сборка `npm run tauri build` на чистой машине | NOT TESTED по ТЗ |
| M2 | Установка NSIS на Windows без dev-зависимостей | Требует VM / чистый профиль |
| M3 | Запуск без установленного WebView2 | Зависит от bootstrapper Tauri по умолчанию |
| M4 | Повторная установка поверх старой версии | Поведение NSIS/Tauri UNVERIFIED |
| M5 | Uninstall: удаляется ли только Program Files, остаётся ли `%LOCALAPPDATA%\StitchVue\` | Нет custom NSIS script в repo |
| M6 | Открытие папки с 10k+ фото, скролл, миниатюры | Performance smoke |
| M7 | Delete / favorites / restore / Windows recycle из UI | I7/I8 UNVERIFIED end-to-end |
| M8 | Полный цикл обновления с GitHub Releases | Updater отсутствует |
| M9 | Ссылки GitHub / Issues в настройках | `githubRepo` пустой |

---

## Этап 1 — детали (Tauri / Windows)

| Параметр | Значение | Источник |
|----------|----------|----------|
| productName | StitchVue | `tauri.conf.json` |
| version | 0.1.0 | `tauri.conf.json`, `Cargo.toml`, `package.json` |
| identifier | com.stitchvue.app | `tauri.conf.json` |
| Bundle targets | nsis only (не msi) | `tauri.conf.json` |
| Tauri crate | 2.12.1 | `Cargo.lock` |
| tauri-build | 2.7.1 | `Cargo.lock` (из вывода `cargo test`) |
| Plugins | dialog 2.8.1 | `Cargo.toml`, `lib.rs` |
| beforeBuildCommand | `npm run build` | `tauri.conf.json` |
| CSP | null | `tauri.conf.json` |
| WebView2 | через wry/webview2-com | `Cargo.lock`; режим установки — дефолт Tauri (**UNVERIFIED**) |

---

## Этап 2 — безопасность данных (сверка с аудитом favorites)

Отчёты в `docs/audit/favorites/` (дата 2026-10-17, read-only) **согласуются с кодом**:

- Copy в избранное — `Action::CopyToLocalFavorites` (`file_ops/mod.rs`); тест `copy_does_not_replace_an_existing_different_file`, `cancelled_copy_publishes_nothing_and_leaves_the_source`.
- Move в локальную корзину — подпапка `Удаленное` в текущем каталоге галереи, не системная корзина (отдельно `recycle_path` для favorites removal / undo paths).
- Восстановление — `restore_local_trash` (`lib.rs` invoke list).
- Reconcile после сбоя — `reconcile_on_boot` при старте pipeline.

**Установка / обновление / удаление приложения и фотографии:** код не записывает user photos в install dir; операции ФС привязаны к явным IPC и выбранному `current_directory`. **Подтверждено кодом** для scope приложения; **не затрагивает** произвольные каталоги при install/uninstall (нет uninstall hooks в репозитории).

Риски из `AUDIT_SUMMARY.md` (FS/SQLite desync, stub undo, partial batch) остаются **PARTIAL/UNVERIFIED** для релиза — не противоречат выводу BLOCKED, но требуют smoke перед заявлением «безопасно для продакшена».

---

## Этап 3 — автообновления

| Требование ТЗ | Статус | Основание |
|---------------|--------|-----------|
| Tauri Updater Plugin | **Нет** | Нет в `Cargo.toml` / `lib.rs` |
| Проверка новой версии | **Нет** | Нет frontend/backend вызовов |
| GitHub Releases endpoint | **Нет** | Нет конфига |
| Проверка подписи | **Нет** | Нет pubkey в `tauri.conf.json` |
| NSIS EXE | **Конфиг есть** | Сборка **NOT TESTED** |
| Кнопки Обновить / Позже | **Нет** | Grep по `src/` — только unrelated «update» |
| Индикация скачивания | **Нет** | — |
| Ошибки сети | **Нет** | — |
| Защита от повторного запуска обновления | **Нет** | — |
| Закрытие и перезапуск | **Нет** | — |
| Проверка активных file ops | **Нет** | — |
| Сохранение SQLite/cache | **Ожидаемо да** (путь в LOCALAPPDATA) | `database/mod.rs`; **UNVERIFIED** при real updater |
| Без согласия не ставить | **N/A** | Updater отсутствует — требование выполняется тривиально, но цель не достигнута |

---

## Этап 4 — GitHub и CI/CD

- **`.gitignore`:** секреты и `node_modules`/`dist` — OK; **`target/` не игнорируется** — см. P1-6.
- **`README.md`:** dev-инструкции; нет Releases/download.
- **LICENSE:** отсутствует.
- **Workflows:** `.github/` отсутствует.
- **Секреты:** grep по типичным паттернам в `*.ts,*.rs,*.json` — явных API keys не найдено; публичные URL/email в `external-links.json`.
- **Соответствие версий:** 0.1.0 везде; **Git tag не проверялся** (вне scope без remote fetch).

---

## Этап 5 — выполненные автоматические проверки

| Команда | Результат | Дата |
|---------|-----------|------|
| `npm run typecheck` | PASS | 2026-10-17 |
| `npm test` | PASS (424) | 2026-10-17 |
| `npm run i18n-check` | PASS | 2026-10-17 |
| `cargo test --lib file_ops` | PASS (110; 2 ignored) | 2026-10-17 |
| `npm run build` | NOT RUN | — |
| `npm run tauri build` | NOT RUN | — |
| ESLint | N/A (нет конфига) | — |

---

## Рекомендуемый порядок задач

1. **LICENSE** + публичный **githubRepo** + README (скачивание, WebView2, путь к user data).
2. **`.gitignore`**: `src-tauri/target/`, убрать `icons/__pycache__` из git.
3. **Первая сборка installer** + ручной smoke (M1–M5, M7) — зафиксировать результаты.
4. **GitHub Actions**: build NSIS на tag (можно без updater в v0.1.0).
5. **Документ `docs/release/RELEASING.md`** (bump, tag, CI, secrets).
6. **tauri-plugin-updater** + подпись + `latest.json` + UI Update/Later + прогресс.
7. **CI signing secrets** + тестовый релиз v0.1.1 (M8).
8. **CSP hardening** + security-review skill.
9. Закрыть **I7/I8** smoke и обновить статусы в `docs/INVARIANTS.md`.
10. (P2) ESLint в CI; E2E favorites IPC.

---

*Аудит выполнен без изменения исходного кода приложения. Единственный записанный артефакт — этот файл.*
