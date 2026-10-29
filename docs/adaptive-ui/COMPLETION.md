# Завершение внедрения adaptive-ui

Дата: 2026-10-29. Ветка: `feature/adaptive-ui-panels`.

## Выполнено по ТЗ

| Этап | Результат |
|------|-----------|
| 1. Аудит | [`AUDIT.md`](./AUDIT.md) |
| 2. План | [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) |
| 3. Git baseline | `40e42d1`; ветка от `main` с rebase |
| 4. Реализация chrome | `--pg-ui-scale` на `:root`, токены, peek TS, все панели и диалоги |
| 5. Автопроверки | typecheck, unit chrome |
| 6. Откат | [`ROLLBACK.md`](./ROLLBACK.md) |

## Охват компонентов

- Shell layout, top/bottom bar, sidebar (pinned/overlay), selection + notices  
- Context menu, tooltip, scroll-jump, gallery empty copy  
- Settings (полный pass типографики), UpdateDialog  
- Favorites/trash/support/rename/photo-properties modals  
- AnimatedModalFrame, ImageViewer nav  
- **Не менялось:** justified/mosaic/columns layout, zoom steps, folder tile 168px grid  

## Автотесты (факт)

```text
npm run typecheck
npm test -- src/features/gallery/lib/chrome/*.test.ts
```

## Ручной прогон

[`TESTING.md`](./TESTING.md)

## HEAD для тестовой сборки

```powershell
git switch feature/adaptive-ui-panels
git log -1 --oneline
npm run tauri dev
```
