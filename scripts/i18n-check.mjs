/**
 * Parity check for shipped dictionaries (ru / en / de / zh-Hans).
 * Exit 0 on success, 1 on failure.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(root, "src/shared/i18n/locales");
const LOCALE_FILES = {
  ru: "ru.json",
  en: "en.json",
  de: "de.json",
  "zh-Hans": "zh-Hans.json",
};

function parseJsonStrict(path) {
  const raw = readFileSync(path, "utf8");
  JSON.parse(raw, function reviver(key, value) {
    return value;
  });
  return { data: JSON.parse(raw), path };
}

function flatten(obj, prefix = "", out = new Map()) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    out.set(prefix, obj);
    return out;
  }
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

function placeholders(text) {
  if (typeof text !== "string") {
    return [];
  }
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

const errors = [];
const flats = new Map();

for (const [locale, file] of Object.entries(LOCALE_FILES)) {
  const parsed = parseJsonStrict(join(localesDir, file));
  flats.set(locale, flatten(parsed.data));
}

const ruFlat = flats.get("ru");
const otherLocales = [...flats.keys()].filter((locale) => locale !== "ru");

for (const locale of otherLocales) {
  const flat = flats.get(locale);
  for (const key of ruFlat.keys()) {
    if (!flat.has(key)) {
      errors.push(`missing in ${locale}: ${key}`);
    }
  }
  for (const key of flat.keys()) {
    if (!ruFlat.has(key)) {
      errors.push(`extra in ${locale}: ${key}`);
    }
  }
}

for (const [key, value] of ruFlat) {
  if (typeof value !== "string") {
    errors.push(`ru non-string: ${key}`);
    continue;
  }
  if (value.trim() === "") {
    errors.push(`ru empty: ${key}`);
  }
  const ruPh = placeholders(value).join(",");
  for (const locale of otherLocales) {
    const otherValue = flats.get(locale).get(key);
    if (typeof otherValue !== "string") {
      continue;
    }
    if (otherValue.trim() === "") {
      errors.push(`${locale} empty: ${key}`);
    }
    const otherPh = placeholders(otherValue).join(",");
    if (ruPh !== otherPh) {
      errors.push(`placeholders mismatch ${key}: ru[${ruPh}] ${locale}[${otherPh}]`);
    }
  }
}

const srcRoot = join(root, "src");
const { readdirSync, statSync } = await import("node:fs");
const staticKeys = new Set();

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(path);
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(name)) continue;
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/\bt\(\s*["']([a-zA-Z0-9_.]+)["']/g)) {
      staticKeys.add(match[1]);
    }
    for (const match of text.matchAll(/\bi18n\.t\(\s*["']([a-zA-Z0-9_.]+)["']/g)) {
      staticKeys.add(match[1]);
    }
  }
}
walk(srcRoot);

for (const key of staticKeys) {
  if (key.includes("${")) continue;
  if (ruFlat.has(key)) continue;
  const dynamicOk =
    key.startsWith("gallery.layout") ||
    key.startsWith("gallery.layoutHint") ||
    key.startsWith("places.drive");
  if (!dynamicOk) {
    errors.push(`static t() unknown key: ${key}`);
  }
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
function pluralBases(flat) {
  const bases = new Map();
  for (const key of flat.keys()) {
    const m = PLURAL_SUFFIX.exec(key);
    if (!m) continue;
    const base = key.slice(0, -m[0].length);
    const set = bases.get(base) ?? new Set();
    set.add(m[1]);
    bases.set(base, set);
  }
  return bases;
}

const ruPlurals = pluralBases(ruFlat);
for (const locale of otherLocales) {
  const otherPlurals = pluralBases(flats.get(locale));
  for (const [base, forms] of ruPlurals) {
    const otherForms = otherPlurals.get(base);
    if (!otherForms) {
      errors.push(`plural base missing in ${locale}: ${base}`);
      continue;
    }
    for (const form of forms) {
      if (!otherForms.has(form)) errors.push(`plural form missing in ${locale}: ${base}_${form}`);
    }
  }
  for (const [base, forms] of otherPlurals) {
    const ruForms = ruPlurals.get(base);
    if (!ruForms) {
      errors.push(`plural base missing in ru (from ${locale}): ${base}`);
      continue;
    }
    for (const form of forms) {
      if (!ruForms.has(form)) errors.push(`plural form missing in ru (from ${locale}): ${base}_${form}`);
    }
  }
}

for (const mode of ["grid", "mosaic", "columns"]) {
  for (const locale of flats.keys()) {
    if (!flats.get(locale).has(`gallery.layout.${mode}`)) {
      errors.push(`missing ${locale} gallery.layout.${mode}`);
    }
  }
}
for (const kind of ["fixed", "removable", "remote", "optical"]) {
  for (const locale of flats.keys()) {
    if (!flats.get(locale).has(`places.drive.${kind}`)) {
      errors.push(`missing ${locale} places.drive.${kind}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`i18n-check failed (${errors.length}):`);
  for (const line of errors.slice(0, 80)) {
    console.error(`  - ${line}`);
  }
  if (errors.length > 80) {
    console.error(`  … and ${errors.length - 80} more`);
  }
  process.exit(1);
}

console.log(
  `i18n-check OK: ${ruFlat.size} leaf keys, parity ru/en/de/zh-Hans, ${staticKeys.size} static t()/i18n.t() keys scanned`,
);
