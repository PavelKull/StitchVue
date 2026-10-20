/**
 * Фасад над `locales/ru.json`.
 * Источник пользовательских строк — JSON; неймспейсы сохранены для текущих импортов.
 * Runtime lookup / смена языка — этап 2 (i18next). Плейсхолдеры — через `t()`.
 */

import catalog from "./locales/ru.json" with { type: "json" };

export const common = catalog.common;
export const places = catalog.places;
export const gallery = catalog.gallery;
export const toolbar = catalog.toolbar;
export const topNav = catalog.topNav;
export const sidebar = catalog.sidebar;
export const settings = catalog.settings;
export const properties = catalog.properties;
export const viewer = catalog.viewer;
export const selection = catalog.selection;
export const folder = catalog.folder;
export const trash = catalog.trash;
export const supportReminder = catalog.supportReminder;
export const appUpdate = catalog.appUpdate;

/** Полный русский каталог (как в JSON). */
export const ru = catalog;

export type RuMessages = typeof catalog;
