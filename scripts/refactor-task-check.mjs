/**
 * Проверка файла задачи рефакторинга и git-изоляции scope.
 * Без внешних зависимостей. Exit 0 — OK, 1 — ошибки.
 *
 * Промпт агента не является механизмом безопасности: перед записью и после
 * неё обязателен этот скрипт. Он обнаруживает нарушение scope, но не может
 * перехватить первый Write инструмента Cursor.
 *
 * Usage:
 *   node scripts/refactor-task-check.mjs docs/refactoring/tasks/TASK-xxx.md
 *   node scripts/refactor-task-check.mjs path/to/task.md --auth
 *   node scripts/refactor-task-check.mjs path/to/task.md --preflight
 *   node scripts/refactor-task-check.mjs path/to/task.md --strict
 *   node scripts/refactor-task-check.mjs path/to/task.md --strict --run-tests
 *   node scripts/refactor-task-check.mjs path/to/task.md --preflight --allow-unrelated-dirty
 *   node scripts/refactor-task-check.mjs path/to/task.md --seal
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, normalize, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_SECTIONS = [
  "## 1. Метаданные",
  "## 2. Scope",
  "## 3. Business invariants",
  "## 4. Acceptance criteria",
  "## 5. Rollback",
];

const REQUIRED_FRONTMATTER = [
  "task_id",
  "title",
  "status",
  "risk",
  "responsible_agent",
  "base_commit",
  "allowed_paths",
];

const STATUSES = [
  "draft",
  "approved",
  "in_progress",
  "verification",
  "completed",
  "blocked",
];

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  const taskPath = args.find((a) => !a.startsWith("--"));
  return {
    help: false,
    taskPath,
    auth: args.includes("--auth"),
    preflight: args.includes("--preflight"),
    strict: args.includes("--strict"),
    runTests: args.includes("--run-tests"),
    allowUnrelatedDirty: args.includes("--allow-unrelated-dirty"),
    seal: args.includes("--seal"),
  };
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { error: "Нет YAML frontmatter (--- ... ---)" };
  const lines = match[1].split(/\r?\n/);
  const data = {};
  let key = null;
  for (const line of lines) {
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(stripQuotes(listItem[1].trim()));
      continue;
    }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const raw = kv[2].trim();
      if (raw === "" || raw === "[]") {
        data[key] = [];
      } else if (raw.startsWith("[")) {
        try {
          data[key] = JSON.parse(raw.replace(/'/g, '"'));
        } catch {
          data[key] = [];
        }
        key = null;
      } else {
        data[key] = stripQuotes(raw);
      }
    }
  }
  return { data };
}

function stripQuotes(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function globToRegExp(glob) {
  const g = normalize(glob).replace(/\\/g, "/");
  let re = "^";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        re += ".*";
        i++;
        if (g[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += ".";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re, "i");
}

function pathMatchesScope(filePath, patterns) {
  const p = normalize(filePath).replace(/\\/g, "/");
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pat) => {
    const norm = pat.replace(/\\/g, "/");
    if (norm.endsWith("/**")) {
      const prefix = norm.slice(0, -3);
      return p === prefix || p.startsWith(prefix + "/");
    }
    if (norm.includes("*") || norm.includes("?")) {
      return globToRegExp(norm).test(p);
    }
    return p === norm || p.startsWith(norm + "/");
  });
}

function resolveGitRepoRoot(startDir) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  return (r.stdout || "").trim();
}

function git(args, gitCwd) {
  const r = spawnSync("git", args, { cwd: gitCwd, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function splitLines(s) {
  return s ? s.split(/\r?\n/).filter(Boolean) : [];
}

function collectWorkingTreeFiles(gitCwd) {
  const names = new Set();
  const unstaged = git(["diff", "--name-only"], gitCwd);
  if (unstaged.ok) splitLines(unstaged.out).forEach((f) => names.add(f));
  const staged = git(["diff", "--name-only", "--cached"], gitCwd);
  if (staged.ok) splitLines(staged.out).forEach((f) => names.add(f));
  const untracked = git(["ls-files", "--others", "--exclude-standard"], gitCwd);
  if (untracked.ok) splitLines(untracked.out).forEach((f) => names.add(f));
  return [...names];
}

function collectCommittedSince(baseCommit, gitCwd) {
  if (!baseCommit) return [];
  const d = git(["diff", "--name-only", baseCommit, "HEAD"], gitCwd);
  if (!d.ok) return [];
  return splitLines(d.out);
}

const HEAD_APPROVED_STATUSES = new Set([
  "approved",
  "in_progress",
  "verification",
  "completed",
]);

function verifyTaskApprovalAtHead({
  gate,
  errors,
  relTask,
  data,
  expectedHash,
  storedHash,
  gitCwd,
}) {
  const gitPath = relTask.replace(/\\/g, "/");
  const shown = git(["show", `HEAD:${gitPath}`], gitCwd);
  if (!shown.ok || !shown.out) {
    errors.push(`${gate}: TASK отсутствует в HEAD — закоммитьте утверждённую задачу`);
    return;
  }
  const headSnap = parseFrontmatter(shown.out);
  if (headSnap.error || !headSnap.data) {
    errors.push(`${gate}: не удалось разобрать TASK в HEAD`);
    return;
  }
  const headStatus = headSnap.data.status;
  if (!HEAD_APPROVED_STATUSES.has(headStatus)) {
    errors.push(
      `${gate}: в HEAD задача не утверждена (status=${headStatus ?? "?"})`,
    );
    return;
  }
  const headContractHash = contractHash(headSnap.data, shown.out);
  if (headContractHash !== expectedHash) {
    errors.push(`${gate}: контракт рабочей копии отличается от HEAD`);
    return;
  }
  const headStoredHash = String(headSnap.data.approval_hash || "").trim();
  if (!headStoredHash || headStoredHash !== storedHash) {
    errors.push(`${gate}: approval_hash рабочей копии не совпадает с HEAD`);
    return;
  }
  const workBase = String(data.base_commit || "").trim();
  const headBase = String(headSnap.data.base_commit || "").trim();
  if (workBase !== headBase) {
    errors.push(`${gate}: base_commit рабочей копии не совпадает с HEAD`);
  }
}

function isImplicitAllowed(filePath, relTask) {
  const p = filePath.replace(/\\/g, "/");
  const task = relTask.replace(/\\/g, "/");
  return p === task;
}

function inAllowed(filePath, allowed, relTask) {
  return (
    isImplicitAllowed(filePath, relTask) || pathMatchesScope(filePath, allowed)
  );
}

function extractContractBody(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const start = body.search(/^## 2\. Scope/m);
  const end = body.search(/^## 5\. Rollback/m);
  if (start < 0 || end < 0 || end <= start) return "";
  return body.slice(start, end).replace(/\r\n/g, "\n").trim();
}

function listField(data, key) {
  const v = data?.[key];
  return Array.isArray(v) ? v : [];
}

function contractPayload(data, text) {
  return [
    data?.task_id ?? "",
    data?.title ?? "",
    data?.risk ?? "",
    data?.responsible_agent ?? "",
    "ALLOWED",
    ...listField(data, "allowed_paths"),
    "FORBIDDEN",
    ...listField(data, "forbidden_paths"),
    "TESTS",
    ...listField(data, "tests"),
    "BODY",
    extractContractBody(text),
  ].join("\n");
}

function contractHash(data, text) {
  return createHash("sha256").update(contractPayload(data, text), "utf8").digest("hex");
}

function upsertFrontmatterField(text, key, value) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return text;
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const fm = match[1];
  const lineRe = new RegExp(`^${key}:\\s*.*$`, "m");
  let newFm;
  if (lineRe.test(fm)) {
    newFm = fm.replace(lineRe, `${key}: ${value}`);
  } else if (/^base_commit:/m.test(fm)) {
    newFm = fm.replace(/^(base_commit:\s*.*)$/m, `$1${nl}${key}: ${value}`);
  } else {
    newFm = `${fm}${nl}${key}: ${value}`;
  }
  return text.replace(match[0], `---${nl}${newFm}${nl}---`);
}

function printHelp() {
  console.log(`refactor-task-check — lint задачи и изоляция git-scope

Без флагов     проверка шаблона (черновик допустим); вне scope — WARN
--seal         только status=approved: записать approval_hash контракта (scope, инварианты, тесты)
--auth         запись: approved|in_progress + совпадающий approval_hash (in_progress сам по себе не разрешение)
--preflight    старт: approved|in_progress + печать + TASK в HEAD + чистые allowed_paths
--strict       после записи: diff ⊆ allowed_paths (+ файл задачи) + печать
--run-tests    выполнить frontmatter tests:
--allow-unrelated-dirty  незакоммиченное вне scope — WARN, не ERR
                          (не использовать молча; спросить пользователя)

Цепочка статусов: draft → approved (--seal) → in_progress → verification → completed.
Смена allowed_paths / §2–4 после печати → FAIL, пока снова status=approved и --seal.
Файл задачи всегда в scope (смена status). Исполнитель не вызывает --seal.
Промпт не блокирует Write: --preflight / --auth / --strict обязательны.`);
}

function riskHeuristics(risk, allowed, errors, warnings) {
  if (risk && !["low", "medium", "high"].includes(risk)) {
    errors.push(`Недопустимый risk: ${risk} (ожидается low|medium|high)`);
    return;
  }
  const paths = (allowed || []).join("\n");
  const rustOrFs = /src-tauri|sqlite|\.sql$/i.test(paths);
  if (risk === "low" && rustOrFs) {
    warnings.push(
      "risk: low при путях src-tauri/SQLite — обычно high (инварианты ФС, не число файлов)",
    );
  }
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const {
    taskPath,
    auth,
    preflight,
    strict,
    runTests,
    allowUnrelatedDirty,
    seal,
  } = opts;
  const errors = [];
  const warnings = [];
  const gate = seal
    ? "seal"
    : preflight
      ? "preflight"
      : strict
        ? "strict"
        : auth
          ? "auth"
          : "lint";

  if (!taskPath) {
    console.error("Укажите путь к файлу задачи. --help для справки.");
    process.exit(1);
  }
  const abs = isAbsolute(taskPath) ? taskPath : join(process.cwd(), taskPath);
  const gitCwd = resolveGitRepoRoot(dirname(abs)) ?? root;
  const relTask = relative(gitCwd, abs).replace(/\\/g, "/");
  if (!existsSync(abs)) {
    console.error(`Файл не найден: ${relTask}`);
    process.exit(1);
  }

  const text = readFileSync(abs, "utf8");
  const { data, error: fmError } = parseFrontmatter(text);
  if (fmError) errors.push(fmError);
  else {
    for (const k of REQUIRED_FRONTMATTER) {
      if (data[k] === undefined) errors.push(`Frontmatter: нет поля ${k}`);
    }
    if (data.status && !STATUSES.includes(data.status)) {
      warnings.push(`Неизвестный status: ${data.status}`);
    }
  }

  for (const h of REQUIRED_SECTIONS) {
    if (!text.includes(h)) errors.push(`Нет раздела: ${h}`);
  }

  const allowed = Array.isArray(data?.allowed_paths) ? data.allowed_paths : [];
  const forbidden = Array.isArray(data?.forbidden_paths)
    ? data.forbidden_paths
    : [];
  const status = data?.status;
  const risk = data?.risk;
  const base = (data?.base_commit || "").trim();

  riskHeuristics(risk, allowed, errors, warnings);

  const writeStatuses = ["approved", "in_progress"];
  const strictStatuses = ["approved", "in_progress", "verification"];
  const storedHash = String(data?.approval_hash || "").trim();
  const expectedHash =
    data && !fmError ? contractHash(data, text) : "";
  const needsSeal =
    seal || auth || preflight || strict;

  if (seal) {
    if (status !== "approved") {
      errors.push(
        `--seal: только status=approved (сейчас ${status}). in_progress не печатает контракт`,
      );
    }
    if (allowed.length === 0) errors.push("--seal: allowed_paths пуст");
    if (!base) errors.push("--seal: base_commit пуст");
  }

  if (auth || preflight || strict) {
    if (preflight && status !== "approved" && status !== "in_progress") {
      errors.push(
        `--preflight: status должен быть approved или in_progress (сейчас ${status})`,
      );
    } else if (auth && !preflight && !strict && !writeStatuses.includes(status)) {
      errors.push(
        `--auth: запись запрещена при status=${status} (нужен approved|in_progress)`,
      );
    } else if (strict && !strictStatuses.includes(status)) {
      errors.push(
        `--strict: status должен быть approved|in_progress|verification (сейчас ${status})`,
      );
    }
    if (allowed.length === 0) {
      errors.push(`${gate}: allowed_paths пуст`);
    }
  }

  if (needsSeal && !seal && data && !fmError) {
    if (!storedHash) {
      errors.push(
        `${gate}: нет approval_hash — сначала status=approved и --seal. in_progress без печати не разрешение`,
      );
    } else if (storedHash !== expectedHash) {
      errors.push(
        `${gate}: approval_hash не совпадает с контрактом (изменились allowed_paths, tests или §2–4). Верните approved и повторите --seal`,
      );
    }
  }

  if ((auth || preflight || strict) && !base) {
    errors.push(`${gate}: base_commit пуст — зафиксируйте SHA до исполнения`);
  }

  const head = git(["rev-parse", "HEAD"], gitCwd);
  const headSha = head.ok ? head.out : "";

  if (base && (auth || preflight || strict || seal)) {
    const obj = git(["cat-file", "-t", base], gitCwd);
    if (!obj.ok || obj.out !== "commit") {
      errors.push(`base_commit не является валидным commit: ${base.slice(0, 12)}`);
    }
  }

  if ((preflight || auth || strict) && base && expectedHash && data && !fmError && storedHash) {
    verifyTaskApprovalAtHead({
      gate,
      errors,
      relTask,
      data,
      expectedHash,
      storedHash,
      gitCwd,
    });
  }

  if (base && head.ok && base !== headSha) {
    const msg = `HEAD (${headSha.slice(0, 7)}) ≠ base_commit (${base.slice(0, 7)})`;
    if (preflight) {
      const inAllowedSince = collectCommittedSince(base, gitCwd).filter(
        (f) =>
          inAllowed(f, allowed, relTask) && !isImplicitAllowed(f, relTask),
      );
      if (inAllowedSince.length) {
        errors.push(
          `${msg}; allowed_paths уже менялись после базы: ${inAllowedSince.join(", ")} — пересмотрите задачу`,
        );
      } else {
        warnings.push(`${msg}; целевые файлы с базы не менялись, но SHA расходится`);
      }
    } else {
      warnings.push(msg);
    }
  }

  const working = collectWorkingTreeFiles(gitCwd);
  const committed = collectCommittedSince(base, gitCwd);
  const changedForScope = [...new Set([...working, ...committed])];

  const dirtyAllowed = working.filter((f) => inAllowed(f, allowed, relTask));
  const dirtyUnrelated = working.filter((f) => !inAllowed(f, allowed, relTask));
  const forbiddenHit = changedForScope.filter(
    (f) => forbidden.length && pathMatchesScope(f, forbidden),
  );

  if (preflight) {
    const dirtyAllowedCode = dirtyAllowed.filter(
      (f) => !isImplicitAllowed(f, relTask),
    );
    if (dirtyAllowedCode.length) {
      errors.push(
        `--preflight: разрешённые файлы уже изменены (нельзя отличить задачу от чужого diff): ${dirtyAllowedCode.join(", ")}`,
      );
    }
    if (dirtyUnrelated.length) {
      const msg = `--preflight: незакоммиченные файлы вне allowed_paths: ${dirtyUnrelated.join(", ")}`;
      if (allowUnrelatedDirty) warnings.push(msg);
      else errors.push(`${msg}; закоммитьте/stash или явно --allow-unrelated-dirty`);
    }
  }

  const outOfScope = changedForScope.filter((f) => !inAllowed(f, allowed, relTask));

  if (strict) {
    if (allowed.length && working.filter((f) => inAllowed(f, allowed, relTask)).length === 0 && committed.filter((f) => inAllowed(f, allowed, relTask)).length === 0) {
      warnings.push("--strict: нет изменений в allowed_paths относительно рабочей копии / base_commit");
    }
    const out = outOfScope;
    if (out.length) {
      const msg = `Вне allowed_paths: ${out.join(", ")}`;
      if (allowUnrelatedDirty) warnings.push(msg);
      else errors.push(msg);
    }
  } else if (!preflight && !auth && allowed.length && outOfScope.length) {
    warnings.push(`Вне allowed_paths (включите --strict чтобы это был ERR): ${outOfScope.join(", ")}`);
  }

  if (forbiddenHit.length) {
    const inScopeForbidden = forbiddenHit.filter((f) =>
      inAllowed(f, allowed, relTask),
    );
    const unrelatedForbidden = forbiddenHit.filter(
      (f) => !inAllowed(f, allowed, relTask),
    );
    if (inScopeForbidden.length) {
      errors.push(`Попали в forbidden_paths: ${inScopeForbidden.join(", ")}`);
    }
    if (unrelatedForbidden.length) {
      const msg = `forbidden_paths вне allowed: ${unrelatedForbidden.join(", ")}`;
      if ((preflight || strict) && !allowUnrelatedDirty) errors.push(msg);
      else warnings.push(msg);
    }
  }

  if ((preflight || strict) && (risk === "medium" || risk === "high")) {
    const tests = Array.isArray(data?.tests) ? data.tests : [];
    if (tests.length === 0) {
      warnings.push(`${gate}: risk=${risk}, но tests: [] — адресные тесты обязательны`);
    }
  }

  if (risk === "high" && !/fixture|временн|temp dir|tmp/i.test(text)) {
    warnings.push(
      "risk: high — в задаче нет явного запрета операций на пользовательских каталогах / указания fixture",
    );
  }

  if (seal && errors.length === 0 && expectedHash) {
    const next = upsertFrontmatterField(text, "approval_hash", expectedHash);
    writeFileSync(abs, next, "utf8");
    console.log(`approval_hash: ${expectedHash}`);
    data.approval_hash = expectedHash;
  }

  console.log(`Задача: ${data?.task_id || "?"} | gate: ${gate}`);
  console.log(
    `Статус: ${status} | Риск: ${risk} | Агент: ${data?.responsible_agent}`,
  );
  if (expectedHash) {
    console.log(
      `Контракт: ${expectedHash.slice(0, 12)}… ${storedHash && storedHash === expectedHash ? "печать OK" : storedHash ? "печать устарела" : "нет печати"}`,
    );
  }
  console.log(
    `Рабочая копия (${working.length}): ${working.slice(0, 12).join(", ")}${working.length > 12 ? "…" : ""}`,
  );

  if (runTests) {
    const tests = Array.isArray(data?.tests) ? data.tests : [];
    if (tests.length === 0) warnings.push("--run-tests: список tests в frontmatter пуст");
    for (const cmd of tests) {
      console.log(`\n> ${cmd}`);
      const r = spawnSync(cmd, { cwd: root, shell: true, stdio: "inherit" });
      if (r.status !== 0) errors.push(`Тест не прошёл: ${cmd}`);
    }
  }

  for (const w of warnings) console.log(`WARN: ${w}`);
  for (const e of errors) console.error(`ERR: ${e}`);

  if (errors.length) {
    console.log("\nИтог: FAIL");
    process.exit(1);
  }
  console.log("\nИтог: OK");
  process.exit(0);
}

main();
