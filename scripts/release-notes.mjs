// Release notes for latest.json → the in-app update dialog.
// User-facing subjects only (feat / fix / perf). No extra dependencies.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TYPE_LABELS = {
  feat: "Новое",
  fix: "Исправления",
  perf: "Скорость",
};

const SCOPE_LABELS = {
  gallery: "Галерея",
  favorites: "Избранное",
  settings: "Настройки",
  viewer: "Просмотр",
  selection: "Выделение",
  folder: "Папки",
  "adaptive-ui": "Интерфейс",
  "app-update": "Обновления",
  update: "Обновления",
  installer: "Установщик",
  i18n: "Языки",
};

const USER_FACING = /^(feat|fix|perf)(?:\(([^)]+)\))?!?:\s*(.+)$/i;

/** Краткий текст диалога обновления (важнее авто-сборки из git). */
const RELEASE_BODY_OVERRIDES = {
  "0.1.7": [
    "Что нового в 0.1.7",
    "",
    "Новое",
    "• Адаптивный интерфейс: панели и плитки папок под размер окна",
    "",
    "Исправления",
    "• Галерея: сортировка по имени по умолчанию",
    "• Галерея: папки открываются без мигания; подсказка «открывается» только при долгой загрузке",
    "• Галерея: «вниз» доводит до конца, пока папка догружается",
    "• Галерея: просмотр не закрывается после удаления и восстановления",
    "• Обновления: понятнее прогресс загрузки",
  ].join("\n"),
};

export function formatReleaseNotes(version, subjects) {
  const cleanVersion = String(version ?? "").replace(/^v/, "").trim() || "—";
  const lines = [];
  const seen = new Set();
  for (const subject of subjects) {
    const item = parseSubject(subject);
    if (!item || seen.has(item.text)) {
      continue;
    }
    seen.add(item.text);
    lines.push(item);
  }

  const header = `Что нового в ${cleanVersion}`;
  if (lines.length === 0) {
    return `${header}\n\nНебольшие внутренние улучшения.`;
  }

  const blocks = [header, ""];
  for (const type of ["feat", "fix", "perf"]) {
    const group = lines.filter((item) => item.type === type);
    if (group.length === 0) {
      continue;
    }
    blocks.push(TYPE_LABELS[type]);
    for (const item of group) {
      blocks.push(`• ${item.text}`);
    }
    blocks.push("");
  }
  return blocks.join("\n").trimEnd();
}

export function previousReleaseTag(tags, current) {
  const currentVersion = semver(current);
  if (!currentVersion) {
    return null;
  }
  let best = null;
  let bestVersion = null;
  for (const tag of tags) {
    if (tag === current) {
      continue;
    }
    const version = semver(tag);
    if (!version || compareSemver(version, currentVersion) >= 0) {
      continue;
    }
    if (!bestVersion || compareSemver(version, bestVersion) > 0) {
      best = tag;
      bestVersion = version;
    }
  }
  return best;
}

function parseSubject(subject) {
  const match = String(subject ?? "").trim().match(USER_FACING);
  if (!match) {
    return null;
  }
  let description = match[3].replace(/\s*\([A-Za-z]+-\d+\)\s*$/g, "").trim();
  description = description.replace(/\s+/g, " ").replace(/[.]+$/g, "");
  if (!description) {
    return null;
  }
  const scope = match[2]?.split(",")[0]?.trim().toLowerCase() ?? "";
  const scopeLabel = SCOPE_LABELS[scope];
  const text = scopeLabel
    ? `${scopeLabel}: ${description.charAt(0).toLowerCase()}${description.slice(1)}`
    : `${description.charAt(0).toUpperCase()}${description.slice(1)}`;
  return { type: match[1].toLowerCase(), text };
}

function semver(tag) {
  const match = String(tag ?? "").match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function notesForTag(tag) {
  const version = String(tag ?? "").replace(/^v/, "").trim();
  if (RELEASE_BODY_OVERRIDES[version]) {
    return RELEASE_BODY_OVERRIDES[version];
  }
  const tags = git(["tag", "--list", "v*"]).split(/\r?\n/).filter(Boolean);
  const previous = previousReleaseTag(tags, tag);
  const range = previous ? `${previous}..HEAD` : "HEAD";
  const log = git(["log", range, "--no-merges", "--pretty=%s"]);
  const subjects = log ? log.split(/\r?\n/) : [];
  return formatReleaseNotes(tag, subjects);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
  if (!tag) {
    process.stderr.write("Usage: node scripts/release-notes.mjs vX.Y.Z\n");
    process.exit(1);
  }
  process.stdout.write(`${notesForTag(tag)}\n`);
}
