# StitchVue — Release Foundation Report

**Дата:** 2026-10-17  
**Основа:** [`RELEASE_READINESS_AUDIT.md`](./RELEASE_READINESS_AUDIT.md)  
**Агенты:** [README + githubRepo](a7fcca1b-6333-4e75-8985-811c766a7e37), [Updater research](2b7ac7e8-e156-42d2-9d18-7af169c2305c)  
**Ограничения этапа:** без коммита, push, публичного релиза, генерации ключей подписи; **Updater и CI/CD не реализованы**.

---

## 1. Выполненные изменения

| Изменение | Файл / действие | Детали |
|-----------|-----------------|--------|
| Remote GitHub | `git remote -v` | `origin` → `https://github.com/PavelKull/StitchVue.git` |
| `githubRepo` | `src/shared/external-links.json` | `https://github.com/PavelKull/StitchVue`; cloudtips, boosty, supportEmail **без изменений** |
| README | `README.md` | Описание, фичи, требования Windows, установка с Releases, багрепорты, `%LOCALAPPDATA%\StitchVue\`, planned updater (не реализован), dev + docs |
| `.gitignore` | `.gitignore` | Добавлено `src-tauri/target/` |
| Индекс Git | `git rm --cached` | Удалён из индекса `src-tauri/icons/__pycache__/render_aurora.cpython-312.pyc` (локальный файл не удалялся; `__pycache__/` уже в `.gitignore`) |
| Аудит / foundation docs | `docs/release/` | `RELEASE_READINESS_AUDIT.md` (ранее), этот отчёт |

**Не изменялось:** галерея, pipeline, SQLite, `file_ops`, `tauri.conf.json`, updater, workflows.

### GitHub Issues URL (проверено по коду)

`src-tauri/src/commands/mod.rs` → `ExternalLinkKind::GithubIssues`: база из `githubRepo` без завершающего `/`, затем **`/issues/new`**.

- Репозиторий: `https://github.com/PavelKull/StitchVue`
- Новая issue: **`https://github.com/PavelKull/StitchVue/issues/new`**

### Секреты и бинарники в Git

- `git ls-files` с расширениями `.exe`, `.dll`, `.pdb`, `.pem`, `.key`, `.env` — **пусто**.
- `.gitignore` покрывает `.env`, `*.pem`, `*.key`, `credentials.json`.

### Состояние рабочей копии перед сборкой (зафиксировано)

Незакоммиченные изменения, **не входящие в foundation**, но присутствовавшие при сборке:

- `M .specify/memory/constitution.md`
- `?? docs/audit/`, `?? specs/`

На результат `typecheck` / `npm test` / `tauri build` они не влияют.

---

## 2. Лицензия — рекомендации (выбор за владельцем)

**Файл LICENSE в репозитории не добавлялся** (требование ТЗ).

### Наблюдения по зависимостям

| Слой | Типичная лицензия | Источник |
|------|-------------------|----------|
| npm (frontend) | **MIT** (большинство пакетов в `package-lock.json`) | `license` в lockfile |
| `@tauri-apps/cli` | **Apache-2.0 OR MIT** | `package-lock.json` |
| Tauri / Rust ecosystem | MIT, Apache-2.0, BSD (per-crate) | `Cargo.lock` / crates.io |

Тяжёлые нативные зависимости (image, rusqlite bundled, decoders) — стандартные open-source лицензии; **полный SPDX-отчёт не генерировался** на этом этапе.

### MIT vs Apache-2.0 для StitchVue

| | MIT | Apache-2.0 |
|---|-----|------------|
| Простота | Короткий текст, привычен для desktop/oss | Длиннее, явный patent grant |
| Совместимость с Tauri/npm | Отличная | Отличная |
| Патентная защита автора | Слабее | Явный grant + termination при патентных исках |
| NOTICE / attribution | Достаточно LICENSE | Часто добавляют `NOTICE` для крупных зависимостей |

**Рекомендация:** для solo/small desktop-проекта чаще выбирают **MIT** (минимум формальностей). Если важна явная patent clause — **Apache-2.0**. Оба совместимы с текущим стеком. После выбора: один файл `LICENSE` в корне + строка в README.

---

## 3. Результаты тестов и сборок

| Команда | Результат | Примечание |
|---------|-----------|------------|
| `npm run typecheck` | **PASS** | 2026-10-17 |
| `npm test` | **PASS** | 424 теста |
| `npm run i18n-check` | **PASS** | 390 leaf keys |
| `npm run build` | **PASS** | Vite production; предупреждение chunk > 500 kB |
| `npm run tauri build` | **PASS** | Release + NSIS; 36 Rust warnings (существующие, не из foundation) |

**Версия приложения в сборке:** `0.1.0` (`tauri.conf.json` / `Cargo.toml` / `package.json`).

**Предупреждение Tauri CLI:** identifier `com.stitchvue.app` оканчивается на `.app` (рекомендация для macOS; для Windows-only релиза — низкий приоритет).

---

## 4. Production build — установщик NSIS

| Поле | Значение |
|------|----------|
| Имя файла | `StitchVue_0.1.0_x64-setup.exe` |
| Версия | **0.1.0** |
| Размер | **6 883 210** bytes (**~6,56 MiB**) |
| Фактический путь (сборка в этой среде) | `C:\Users\Pavel\AppData\Local\Temp\cursor-sandbox-cache\e739d2209fa354832c79dd2928c9288d\cargo-target\release\bundle\nsis\StitchVue_0.1.0_x64-setup.exe` |

**Важно:** в среде Cursor `cargo` использовал **sandbox `CARGO_TARGET_DIR`**, поэтому артефакт **не** появился в `src-tauri/target/...` на диске проекта. При обычном локальном `npm run tauri build` ожидаемый путь:

```text
<repo>\src-tauri\target\release\bundle\nsis\StitchVue_0.1.0_x64-setup.exe
```

Подписи updater (`.sig`, `latest.json`) **не создавались** — `createUpdaterArtifacts` не включён.

---

## 5. Оставшиеся блокеры (к публичному релизу)

| Приоритет | Блокер | Статус после foundation |
|-----------|--------|-------------------------|
| P0 | **LICENSE** не выбран / не добавлен | Открыт |
| P0 | **GitHub Actions** / публикация Release | Открыт |
| P0 | **Tauri Updater** (цели 3–6 аудита) | Открыт (только план) |
| P0 | **Ручной smoke** установщика на чистой Windows | Открыт |
| P1 | **CSP null** в `tauri.conf.json` | Без изменений |
| P1 | **I7/I8** UNVERIFIED + manual smoke INVARIANTS | Без изменений |
| P1 | Ключи подписи updater в CI | Не созданы (по ТЗ) |
| P2 | ESLint в gate | Без изменений |

**Снято с foundation:** пустой `githubRepo`, отсутствие README для пользователей, отслеживаемый `__pycache__`, отсутствие `src-tauri/target/` в `.gitignore`, непроверенная production-сборка (теперь **PASS** в sandbox).

---

## 6. Минимальное ТЗ — Tauri Updater (реализация не начата)

**Цель:** проверка обновлений с GitHub Releases, уведомление, установка **только после согласия**, сохранение `%LOCALAPPDATA%\StitchVue\`.

### Зависимости (согласовать с Tauri 2.12.x)

| Компонент | Версия |
|-----------|--------|
| `tauri` (уже) | 2.12.1 |
| `tauri-plugin-updater` | **2.12.0** (или `"2.12"`) |
| `@tauri-apps/plugin-updater` | **2.12.0** |

Документация: [Tauri 2 Updater](https://v2.tauri.app/plugin/updater/), [updater@2.12.0](https://v2.tauri.app/release/updater/v2.12.0/).

### Конфигурация

- `bundle.createUpdaterArtifacts: true`
- `plugins.updater.pubkey` — **публичный** ключ в `tauri.conf.json`
- `plugins.updater.endpoints` — например  
  `https://github.com/PavelKull/StitchVue/releases/latest/download/latest.json`
- `plugins.updater.windows.installMode`: `passive` (рекомендация Tauri)

### Rust / frontend

- Зарегистрировать `tauri_plugin_updater` в `lib.rs` (desktop).
- UI: `check()` → диалог **Update** / **Later** → `downloadAndInstall()` только по Update.
- **Не** вызывать автоустановку при старте без подтверждения.

### Capabilities

В `src-tauri/capabilities/default.json` добавить:

```json
"updater:default"
```

### Блокировка при файловых операциях

1. Новая read-only команда, например `file_operation_in_progress() -> bool` (реестр `file_ops::claim`).
2. Перед `downloadAndInstall`: проверка UI (`fileOperation`, `unfavoriteBusy`) + invoke IPC.
3. Опционально: `prepare_app_update()` → `Err` если registry не пуст.

Опора: `run_file_operation` + `Claim::Busy` в `commands/mod.rs` / `file_ops/mod.rs`.

### Критерии приёмки

- Без клика «Обновить» установка не начинается.
- При активной file op — отказ с понятным сообщением.
- После обновления: те же favorites/настройки/cache path; фото в пользовательских папках не изменены.

---

## 7. Минимальное ТЗ — GitHub Actions

**Цель:** по тегу `v*` собрать NSIS, подписать updater-артефакты, опубликовать Release.

### Workflow (эскиз)

- **Runner:** `windows-latest`
- **Trigger:** `push` tags `v*` или `workflow_dispatch`
- **Steps:** checkout → Node + Rust → `npm ci` → `npm run tauri build`
- **Action:** `tauri-apps/tauri-action@v1` ([документация](https://v2.tauri.app/distribute/pipelines/github/))
- **permissions:** `contents: write`

### Secrets (имена из документации Tauri)

| Secret | Назначение |
|--------|------------|
| `GITHUB_TOKEN` | Публикация Release (встроенный) |
| `TAURI_SIGNING_PRIVATE_KEY` | Приватный ключ minisign (содержимое или путь) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Пароль ключа (пусто, если без пароля) |

**Приватный ключ не хранить в репозитории.** Генерация — отдельным шагом с разрешением владельца (`tauri signer generate`).

### Артефакты Release

| Файл | Назначение |
|------|------------|
| `StitchVue_<version>_x64-setup.exe` | Установщик NSIS |
| `StitchVue_<version>_x64-setup.exe.sig` | Подпись |
| `latest.json` | Метаданные updater (`version`, `platforms.windows-x86_64.url`, `signature`) |

Endpoint приложения: `releases/latest/download/latest.json` (Release должен быть **Latest**).

### Критерии приёмки CI

- Tag `v0.1.1` создаёт Release с тремя артефактами выше.
- `latest.json` валидируется схемой Tauri 2 ([Static JSON](https://v2.tauri.app/plugin/updater/)).
- Локальная сборка без secrets по-прежнему возможна (без `.sig`).

---

## 8. План тестирования перехода версий (0.1.0 → 0.1.1)

| # | Шаг | Ожидание |
|---|-----|----------|
| 1 | Установить **0.1.0** NSIS | Версия 0.1.0, запуск OK |
| 2 | Открыть папку, кэш, избранное, настройки | `%LOCALAPPDATA%\StitchVue\` заполнен |
| 3 | Зафиксировать baseline (DB, favorites, last folder) | Для сравнения |
| 4 | Опубликовать **0.1.1** с signed `latest.json` | Endpoint доступен |
| 5 | Check update в приложении | Предложение 0.1.1, подпись OK |
| 6 | Начать file op → попытка update | **Блокировка** |
| 7 | Update после простоя | 0.1.1, данные на месте |
| 8 | Повторный setup 0.1.1 поверх | Данные сохранены |
| 9 | Проверить, что каталоги фото не изменены | Только install dir обновлён |

**Примечание:** in-app update **0.1.0 → 0.1.1** возможен только если **0.1.0 уже содержит updater + pubkey**. Иначе первый in-app тест — с **0.1.1 → 0.1.2**, а 0.1.0→0.1.1 проверять **ручной переустановкой NSIS**.

---

## 9. Инструкция ручного тестирования EXE

**Подготовка:** Windows 10/11 x64, учётная запись с правами установки. Скачать или скопировать `StitchVue_0.1.0_x64-setup.exe` с машины сборки (см. §4). Закрыть другие экземпляры StitchVue.

### Установка

1. Запустить `StitchVue_0.1.0_x64-setup.exe`.
2. Пройти мастер NSIS (путь по умолчанию).
3. Запустить из меню Пуск.
4. Убедиться, что окно открывается без Node/Rust в PATH.

### Функциональный минимум

5. Открыть тестовую папку с изображениями (не production-библиотеку с единственной копией).
6. Дождаться появления плейсхолдеров / миниатюр.
7. Проверить `%LOCALAPPDATA%\StitchVue\` — появились `stitchvue.db` и `cache\`.
8. Settings → About → **GitHub** и **Issues** открывают `github.com/PavelKull/StitchVue` и `/issues/new`.

### Удаление

9. Закрыть приложение.
10. «Удаление программ» → StitchVue → Uninstall.
11. Проверить: бинарь удалён; **ожидаемо** `%LOCALAPPDATA%\StitchVue\` может остаться (кэш/БД) — задокументировать фактическое поведение.

### Повторная установка

12. Установить тот же EXE снова.
13. Убедиться, что старые данные в `%LOCALAPPDATA%\StitchVue\` подхватываются (если папка не удалялась вручную).

### Запись результата

Заполнить таблицу (в issue или `docs/release/`):

| Шаг | Pass/Fail | OS build | Примечание |
|-----|-----------|----------|------------|
| Install | | | |
| Launch | | | |
| Open folder | | | |
| App data path | | | |
| GitHub links | | | |
| Uninstall | | | |
| Reinstall | | | |

---

## 10. Следующий этап (после проверки foundation владельцем)

**Не начинать до явного одобрения:**

1. Выбор и добавление **LICENSE**.
2. Минимальный **workflow** `release.yml` (tag + NSIS, без updater — или сразу с signing).
3. Реализация **Updater** по §6.
4. Первый **draft Release** + ручной smoke §9.
5. Коммит foundation-изменений (`.gitignore`, `external-links.json`, `README`, удаление pycache из индекса, `docs/release/*`).

---

*Отчёт сформирован по результатам этапа Release Foundation. Updater и CI/CD не внедрялись.*
