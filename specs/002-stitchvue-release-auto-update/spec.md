# Feature Specification: stitchvue-release-auto-update

**Feature ID**: `stitchvue-release-auto-update`  
**Spec directory**: `specs/002-stitchvue-release-auto-update`  
**Feature Branch** (optional): `002-stitchvue-release-auto-update`

**Created**: 2026-10-17

**Status**: Draft — [`plan.md`](./plan.md) ready; implementation **not** started

**Input**: Первая публичная публикация StitchVue на GitHub с CI/CD, подписанными GitHub Releases и in-app Tauri Updater (Windows NSIS).

**Priority**: P0 — блокирует публичный релиз.

## References

| Document | Role |
|----------|------|
| [`docs/release/RELEASE_READINESS_AUDIT.md`](../../docs/release/RELEASE_READINESS_AUDIT.md) | Исходный аудит, блокеры P0/P1 |
| [`docs/release/RELEASE_FOUNDATION_REPORT.md`](../../docs/release/RELEASE_FOUNDATION_REPORT.md) | Версии Tauri, артефакты, ТЗ updater/CI, smoke EXE |
| [`README.md`](../../README.md) | Пользовательская установка; updater пока «planned» — обновить после реализации |
| [`docs/INVARIANTS.md`](../../docs/INVARIANTS.md) | I6–I8 (file ops); не нарушать при обновлении |
| [Tauri 2 Updater](https://v2.tauri.app/plugin/updater/) | Подпись, `latest.json`, API |
| [Tauri GitHub Actions](https://v2.tauri.app/distribute/pipelines/github/) | `tauri-action`, secrets |

**Repository**: `https://github.com/PavelKull/StitchVue`

**Baseline stack** (из foundation, не переисследовать): Tauri **2.12.1**, `@tauri-apps/cli` **2.12.1**, bundle **NSIS x64**, `identifier` `com.stitchvue.app`, app data `%LOCALAPPDATA%\StitchVue\`.

## Executive Summary

Реализовать **сквозной контур релиза и обновления** для Windows: GitHub Actions собирает и публикует подписанный NSIS + `latest.json`; приложение при **запуске** проверяет обновление, показывает диалог с версией и release notes, по согласию пользователя скачивает с прогрессом и устанавливает через Tauri Updater с проверкой подписи. Обновление **не** должно прерывать активные файловые операции и **не** должно затрагивать пользовательские фотографии, SQLite, настройки и кэш в `%LOCALAPPDATA%\StitchVue\`.

**Первый публичный GitHub Release** обязан уже содержать **рабочий** Updater (не «догоняющий» патч позже).

**Предусловие публикации**: владелец выбирает и коммитит **LICENSE** (MIT или Apache-2.0 — см. foundation §2) **до** пометки Release как Latest для широкой аудитории.

## Goals (mapping to product intent)

| # | Цель | Spec anchor |
|---|------|-------------|
| G1 | CI: Windows EXE | FR-REL-01…05, US-3 |
| G2 | Подписанные GitHub Releases | FR-REL-06…10 |
| G3 | Проверка версии при запуске | FR-REL-11…12 |
| G4 | UI: версия, notes, «Обновить» / «Позже» | FR-REL-13…16 |
| G5 | Установка только после согласия | FR-REL-17…18 |
| G6 | Прогресс и ошибки сети | FR-REL-19…22 |
| G7 | Не прерывать file ops | FR-REL-23…25 |
| G8 | Сохранить фото, SQLite, settings, cache | FR-REL-26…30 |
| G9 | Подлинность через Tauri Updater | FR-REL-31…33 |
| G10 | Повторяемый процесс версий | FR-REL-34…38, US-4 |

## Out of Scope

- macOS / Linux bundles и updater targets.
- MSI, Microsoft Store, winget (только NSIS EXE).
- Автоустановка без диалога; фоновая установка при старте без клика «Обновить».
- Рефакторинг галереи, thumbnail pipeline, `file_ops` алгоритмов (допустим **минимальный** read-only IPC для busy-gate).
- Изменение семантики delete/favorites/trash/recycle.
- Публикация релизов и `git push` в рамках **этой** спецификации (описать процесс; выполняет человек/CI по триггеру).
- Генерация и коммит приватных ключей подписи.
- Полный SPDX-отчёт зависимостей (отдельная задача; LICENSE — обязательный минимум).

## Assumptions

- Пользователи на **Windows 10+ x64** с WebView2 (установлен или через bootstrapper NSIS).
- GitHub Releases доступен по HTTPS; для production **не** использовать `dangerousInsecureTransportProtocol`.
- Одна линия подписи: один minisign key pair; **публичный** ключ в `tauri.conf.json`, **приватный** только в GitHub Secrets / локально у maintainer.
- Версия приложения синхронизирована в `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json` и Git tag `vX.Y.Z`.
- Release notes для пользователя берутся из поля `notes` в `latest.json` / GitHub Release body (источник зафиксирует plan).
- «Позже» откладывает предложение до **следующего запуска** приложения (не обязательно фоновый re-check в той же сессии, если не указано иное в plan).

## Clarifications

### Session 2026-10-17

- **CL-R01** — Первый **публичный** релиз = первый GitHub Release, предназначенный для скачивания end users, уже с включённым updater и подписанными артефактами. Внутренние тестовые теги (`v0.1.0-test.1`) допустимы для проверки CI/updater до публичного объявления.
- **CL-R02** — Проверка обновления: **один раз при запуске** (после основного окна готово / app setup), не в цикле каждые N минут в v1.
- **CL-R03** — При активной файловой операции: кнопка «Обновить» недоступна или показывает объяснение; **не** вызывать `download`/`install` до idle.
- **CL-R04** — Данные в `%LOCALAPPDATA%\StitchVue\` **не** удаляются и **не** перезаписываются установщиком обновления; меняется только каталог установки приложения (Program Files / Local AppData installer path per NSIS).
- **CL-R05** — LICENSE выбран владельцем и присутствует в корне репо **до** публичного Latest Release.

---

## User Scenarios & Testing

### User Story 1 — Узнать о новой версии и отложить (Priority: P1)

Пользователь запускает StitchVue. Доступна более новая подписанная версия на GitHub. Появляется ненавязчивое уведомление с номером версии и кратким описанием изменений. Пользователь нажимает «Позже» и продолжает работу с галереей без скачивания.

**Why this priority**: Без согласия не должно быть загрузки; отложить — основной безопасный путь.

**Independent Test**: Опубликовать тестовый `latest.json` с версией выше установленной; запустить app; убедиться, что после «Позже» загрузка не началась.

**Acceptance Scenarios**:

1. **Given** установлена `vA`, на endpoint `latest.json` версия `vB` > `vA`, **When** пользователь запускает приложение, **Then** показывается диалог с `vB`, notes и кнопками «Обновить» / «Позже».
2. **Given** диалог виден, **When** пользователь нажимает «Позже», **Then** диалог закрывается, скачивание **не** начинается, галерея работает как до запуска.
3. **Given** пользователь нажал «Позже» в прошлой сессии, **When** он снова запускает приложение и `vB` всё ещё актуальна, **Then** диалог показывается снова (CL-R02).

---

### User Story 2 — Обновить по согласию с прогрессом (Priority: P1)

Пользователь соглашается на обновление. Приложение скачивает пакет, показывает прогресс, проверяет подпись и запускает установку NSIS в режиме, рекомендованном Tauri (`passive`), затем перезапускает приложение.

**Why this priority**: Ядро G5–G6, G9.

**Independent Test**: Две подписанные тестовые версии на GitHub (см. § Verification: two-version upgrade); путь happy-path.

**Acceptance Scenarios**:

1. **Given** нет активных file ops, **When** пользователь нажимает «Обновить», **Then** начинается загрузка и отображается прогресс (процент или индикатор).
2. **Given** загрузка завершена и подпись верна, **When** установка выполняется, **Then** приложение перезапускается на новой версии без ошибки.
3. **Given** пользователь **не** нажимал «Обновить», **When** проходит 60 с после старта, **Then** загрузка/установка **не** начались сами.

---

### User Story 3 — Maintainer публикует версию через CI (Priority: P1)

Maintainer повышает версию, создаёт tag `vX.Y.Z`, push на GitHub. Workflow на Windows собирает NSIS, подписывает артефакты, публикует Release с `.exe`, `.sig`, `latest.json`.

**Why this priority**: Без CI нет воспроизводимых подписанных обновлений.

**Independent Test**: Tag на тестовую ветку или `workflow_dispatch` с тестовым tag; проверить артефакты Release.

**Acceptance Scenarios**:

1. **Given** секреты подписи настроены в GitHub, **When** push tag `v1.0.1`, **Then** Release содержит `StitchVue_1.0.1_x64-setup.exe`, `.sig`, `latest.json`.
2. **Given** `latest.json` на `releases/latest/download/`, **When** открыть URL, **Then** `platforms.windows-x86_64` содержит `url` и `signature` (тело `.sig`).
3. **Given** локальная сборка без secrets, **When** `npm run tauri build`, **Then** сборка **успешна** (артефакты updater опционально без подписи — dev-only).

---

### User Story 4 — Повторный релиз patch-версии (Priority: P2)

Maintainer выпускает `v1.0.2` по документированному чеклисту: bump версий, changelog, tag, CI, smoke на VM.

**Why this priority**: G10 — устойчивый процесс.

**Independent Test**: Второй подряд tag без ручной правки workflow.

**Acceptance Scenarios**:

1. **Given** документ `docs/release/RELEASING.md`, **When** maintainer следует чеклисту, **Then** все шаги воспроизводимы без изменения кода.
2. **Given** установлена `v1.0.1` с updater, **When** опубликована `v1.0.2`, **Then** in-app update предлагает `1.0.2` и успешно обновляет (см. two-version test).

---

### Edge Cases & Negative Scenarios

| ID | Сценарий | Ожидаемое поведение |
|----|----------|---------------------|
| N-01 | Нет сети при check | Не падать; без диалога или ненавязчивое «проверка обновлений недоступна» (не блокирует галерею) |
| N-02 | Timeout / HTTP 5xx на endpoint | Как N-01; логировать; не retry loop в v1 |
| N-03 | `latest.json` 404 | Как N-01 |
| N-04 | Версия на сервере ≤ текущая | Диалог **не** показывать |
| N-05 | Неверная / подменённая подпись | Отказ установки; сообщение пользователю; приложение остаётся на текущей версии |
| N-06 | Подменённый `latest.json` с низкой версией | Comparator Tauri отклоняет downgrade (если `allowDowngrades: false`) |
| N-07 | Обрыв загрузки | Показать ошибку; остаться на текущей версии; повтор возможен после «Обновить» |
| N-08 | Диск заполнен при download | Ошибка с понятным текстом; не частичная установка |
| N-09 | Пользователь закрыл окно во время download | Отмена/ошибка без corrupt install |
| N-10 | Активный `run_file_operation` | «Обновить» заблокировано; после завершения op — разблокировано |
| N-11 | Активный mass unfavorite / `unfavoriteBusy` | Как N-10 |
| N-12 | Двойной клик «Обновить» | Идемпотентность: один download/install pipeline |
| N-13 | Установка поверх открытого приложения | Tauri/NSIS закрывает app перед install (стандартное поведение); file ops должны быть завершены (N-10) |
| N-14 | Пользовательские фото в `D:\Photos\` | **Нет** чтения/записи/удаления при update |
| N-15 | `%LOCALAPPDATA%\StitchVue\` после update | `stitchvue.db`, cache, settings сохранены (сравнить hash/size выборочно) |
| N-16 | CI без `TAURI_SIGNING_PRIVATE_KEY` | Workflow fail на release job (не публиковать неподписанный Latest для updater) |
| N-17 | Публичный релиз без LICENSE | **Блокер процесса** — не помечать Latest (CL-R05) |

---

## File & Data Safety

### Что установка/обновление **не должно** менять

| Область | Расположение | Инвариант |
|---------|--------------|-----------|
| Оригиналы фото | Пути, выбранные пользователем | I8; только явные user file ops |
| Копии избранного / локальная корзина | Внутри открытых библиотек | Не затрагиваются updater |
| SQLite + cache | `%LOCALAPPDATA%\StitchVue\` | CL-R04; FR-REL-28 |
| Настройки UI | localStorage / prefs (как сейчас) | Сохраняются между версиями |
| Содержимое пользовательских каталогов при install dir upgrade | — | Только бинарь StitchVue и ярлыки |

### Что допустимо менять

- Файлы в каталоге установки приложения (NSIS target).
- Версия, отображаемая в About / `getVersion`.

### Связь с file operations

- Перед `downloadAndInstall` / `install`: проверка **UI state** (`fileOperation`, unfavorite busy) **и** IPC `file_operation_in_progress()` (новая минимальная команда — opора на registry `file_ops::claim`, см. foundation).
- Не отменять успешные file ops ради update; не вызывать `cancel_file_operation` автоматически.

---

## Requirements

### Functional Requirements — CI & Release

- **FR-REL-01**: Репозиторий MUST содержать GitHub Actions workflow для **windows-latest**, триггер tag `v*` и/или `workflow_dispatch`.
- **FR-REL-02**: Workflow MUST выполнять `npm ci`, `npm run build`, `npm run tauri build` (x64).
- **FR-REL-03**: Workflow MUST публиковать GitHub Release с NSIS `.exe` для Windows x64.
- **FR-REL-04**: Workflow MUST использовать `tauri-apps/tauri-action` (или эквивалент с теми же гарантиями) с `permissions: contents: write`.
- **FR-REL-05**: Локальная разработка MUST сохранять возможность `tauri build` без CI secrets.

- **FR-REL-06**: Production Release MUST включать `.exe.sig` для NSIS bundle.
- **FR-REL-07**: Production Release MUST включать `latest.json` на `releases/latest/download/latest.json` (Release помечен **Latest**).
- **FR-REL-08**: `latest.json` MUST соответствовать схеме Tauri 2 (`version`, `platforms.windows-x86_64.url`, `platforms.windows-x86_64.signature`).
- **FR-REL-09**: Приватный ключ подписи MUST NOT храниться в git; только GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` (+ optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
- **FR-REL-10**: Публичный ключ MUST быть в `tauri.conf.json` (`plugins.updater.pubkey`).

### Functional Requirements — Updater config

- **FR-REL-11**: Приложение MUST использовать `tauri-plugin-updater` и `@tauri-apps/plugin-updater`, версии **согласованы с Tauri 2.12.x** (pin 2.12.0 per foundation).
- **FR-REL-12**: `tauri.conf.json` MUST set `bundle.createUpdaterArtifacts: true`, `plugins.updater.endpoints` → GitHub latest JSON URL для `PavelKull/StitchVue`.
- **FR-REL-13**: Capabilities MUST grant `updater:default` (не шире).
- **FR-REL-14**: Plugin MUST register только на desktop (Windows).

### Functional Requirements — UX & consent

- **FR-REL-15**: При запуске приложения MUST выполняться `check()` (после готовности UI), если сеть доступна.
- **FR-REL-16**: При доступной более новой версии MUST показываться modal/dialog: **версия**, **release notes** (из update metadata), кнопки **«Обновить»** / **«Позже»** (i18n: ru/en/de/zh-Hans минимум для новых строк).
- **FR-REL-17**: `download` / `downloadAndInstall` / `install` MUST вызываться **только** после явного «Обновить».
- **FR-REL-18**: «Позже» MUST закрывать диалог без side effects на ФС.

- **FR-REL-19**: Во время загрузки MUST отображаться прогресс (event/callback plugin updater).
- **FR-REL-20**: Ошибки сети, подписи и установки MUST показываться пользователю и MUST NOT оставлять приложение в нерабочем состоянии.
- **FR-REL-21**: Повторная попытка после ошибки MUST быть доступна без перезапуска ОС (достаточно закрыть диалог ошибки и снова открыть update flow или перезапустить app).
- **FR-REL-22**: MUST NOT использовать авто-install при старте.

### Functional Requirements — File operation gate

- **FR-REL-23**: MUST expose `file_operation_in_progress() -> bool` (или эквивалент) без изменения семантики `run_file_operation`.
- **FR-REL-24**: Перед началом download/install MUST отклонять update, если file op или unfavorite busy.
- **FR-REL-25**: Сообщение пользователю MUST объяснять отложить update до завершения операции.

### Functional Requirements — Data preservation

- **FR-REL-26**: Updater MUST NOT писать в пользовательские photo directories.
- **FR-REL-27**: Updater MUST NOT удалять `%LOCALAPPDATA%\StitchVue\` при обновлении.
- **FR-REL-28**: После update MUST сохраняться: favorites state, recent folder, cache entries (spot-check), `stitchvue.db` presence.
- **FR-REL-29**: Поведение галереи, pipeline, IPC file ops MUST остаться без регрессий (smoke: open folder, scroll, delete to local trash, favorite one photo).
- **FR-REL-30**: Существующие automated tests (`npm test`, `cargo test` file_ops) MUST pass без изменения ожидаемого поведения file ops.

### Functional Requirements — Security & authenticity

- **FR-REL-31**: MUST verify update signature (Tauri updater default); reject tampered packages (N-05).
- **FR-REL-32**: Endpoints MUST be HTTPS only in production config.
- **FR-REL-33**: MUST NOT enable `dangerousInsecureTransportProtocol` for production.

### Functional Requirements — Release process & license

- **FR-REL-34**: MUST добавить `docs/release/RELEASING.md` с чеклистом: LICENSE check → version bump (3 files) → changelog → tag → CI → smoke → mark Latest.
- **FR-REL-35**: Version in tag MUST match `tauri.conf.json` / `Cargo.toml` / `package.json`.
- **FR-REL-36**: README MUST обновлён: in-app updates **available** (после реализации), не «planned».
- **FR-REL-37**: Первый публичный релиз MUST ship с FR-REL-11…22 уже включёнными.
- **FR-REL-38**: LICENSE file MUST exist in repo root before public Latest (CL-R05).

### Key Entities

- **Release artifact set**: NSIS `.exe`, `.sig`, `latest.json` per version tag.
- **Update offer**: `{ version, notes, pub_date? }` from check API.
- **Update session state**: idle | checking | available | downloading(progress) | installing | error.
- **File busy gate**: composite(UI refs + IPC boolean).

---

## Verification: Two test versions (mandatory before public Latest)

Цель: доказать in-app upgrade **между двумя тестовыми сборками** с тем же pubkey и CI pipeline.

### Подготовка

1. Сгенерировать key pair (maintainer, вне repo): `tauri signer generate -w ~/.tauri/stitchvue.key`.
2. Публичный ключ в конфиг; приватный в GitHub Secrets.
3. Опубликовать **тестовые** теги (не обязательно публично анонсировать):
   - `v0.1.100-test.1` — минимальная разница в About (version string).
   - `v0.1.100-test.2` — notes «Test update 2»; изменение видно в UI.

### Процедура

| Step | Action | Expected |
|------|--------|----------|
| T1 | Install `test.1` NSIS на чистой VM | About = `0.1.100-test.1` |
| T2 | Создать данные: открыть fixture folder, favorite 1 photo, settings tweak | `%LOCALAPPDATA%\StitchVue\` populated |
| T3 | Snapshot: DB file size, favorite count, setting value | Baseline recorded |
| T4 | Publish `test.2` via CI with signed `latest.json` | Endpoint live |
| T5 | Restart app (`test.1`) | Dialog offers `test.2` + notes |
| T6 | «Позже» | No download |
| T7 | Restart; «Обновить» with idle FS | Progress → restart → About = `test.2` |
| T8 | Re-run T3 checks | Match baseline (data preserved) |
| T9 | Photo paths outside LOCALAPPDATA | Unmodified (mtime/size spot-check) |
| T10 | Start delete/favorite batch; attempt update | Blocked (N-10) |
| T11 | Tamper `latest.json` signature on fork | Install rejected (N-05) |

После T1–T11 разрешён первый **публичный** tag (например `v1.0.0`) с тем же механизмом.

---

## Success Criteria

| ID | Criterion |
|----|-----------|
| SC-REL-001 | Maintainer может выпустить подписанный Windows Release одним tag push без ручной сборки EXE на машине. |
| SC-REL-002 | 100% попыток установки без нажатия «Обновить» не приводят к download (manual test N/A + automated hook test where feasible). |
| SC-REL-003 | Two-version test T1–T9 pass on Windows 10/11 x64 VM. |
| SC-REL-004 | После update пользовательские photo files в тестовой библиотеке byte-identical. |
| SC-REL-005 | `npm run typecheck`, `npm test`, `npm run i18n-check` pass в CI и локально на release branch. |
| SC-REL-006 | Неверная подпись блокирует установку (T11). |
| SC-REL-007 | LICENSE присутствует до публичного Latest. |

---

## Implementation Boundaries (minimal architecture touch)

Допустимые зоны изменений (для `/speckit-plan`, без реализации здесь):

| Area | Allowed change |
|------|----------------|
| `src-tauri/tauri.conf.json` | updater plugin config, `createUpdaterArtifacts` |
| `src-tauri/Cargo.toml` | `tauri-plugin-updater` |
| `src-tauri/src/lib.rs` | plugin init |
| `src-tauri/capabilities/default.json` | `updater:default` |
| `src-tauri/src/commands/mod.rs` | `file_operation_in_progress` only |
| `src-tauri/src/file_ops/mod.rs` | export busy probe (read-only) |
| `package.json` | `@tauri-apps/plugin-updater` |
| `src/features/.../update` (new FSD slice) | dialog, hook on startup |
| `src/shared/i18n/locales/*.json` | new strings |
| `.github/workflows/release.yml` | new file |
| `docs/release/RELEASING.md` | new file |
| `LICENSE` | owner adds |
| `README.md` | updater section |

**Forbidden**: `pipeline/`, gallery layout, `file_ops` execute paths, SQLite schema, изменение `Action` enum.

---

## Constitution & Invariants Alignment

- **I6** (claim/replay): новая IPC только читает registry; не меняет claim semantics.
- **I7/I8**: update flow не должен маскировать file op errors; smoke после релиза.
- **Safe refactoring**: отдельные задачи в `docs/refactoring/tasks/` при medium/high touch; этот feature — **high** для CI secrets и updater, **medium** для UI slice.

---

## Deferred to `/speckit-plan`

- Точное размещение FSD-модуля (`features/app-update` vs `features/settings`).
- Использовать `download` + `install` отдельно vs `downloadAndInstall`.
- `installMode`: `passive` vs `basicUi`.
- Draft vs published Release в CI для первых прогонов.
- Unit-тесты для gate (mock invoke) vs только manual T10.

---

*Спецификация `stitchvue-release-auto-update` — только документ; код и workflow не создаются на этом этапе.*
