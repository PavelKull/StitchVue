import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "refactor-task-check.mjs");
const TASK_NAME = "TASK-TMP-GATE.md";

function gitRun(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return (r.stdout || "").trim();
}

function initRepo(dir) {
  gitRun(dir, ["init", "-b", "main"]);
  gitRun(dir, ["config", "user.email", "task-check@test"]);
  gitRun(dir, ["config", "user.name", "task-check"]);
}

function commitAll(dir, message) {
  gitRun(dir, ["add", "-A"]);
  gitRun(dir, ["commit", "-m", message]);
}

function taskMarkdown({ status, hash, extraPath, base }) {
  const allowed = ["src/pages/gallery/ttlPreset.ts"];
  if (extraPath) allowed.push(extraPath);
  const hashLine = hash ? `approval_hash: ${hash}\n` : "";
  return `---
task_id: TASK-TMP-GATE
title: Gate test
status: ${status}
risk: low
responsible_agent: frontend-executor
base_commit: "${base}"
${hashLine}allowed_paths:
${allowed.map((p) => `  - ${p}`).join("\n")}
forbidden_paths:
  - src-tauri/**
tests:
  - npm run typecheck
---

# Задача: Gate test

## 1. Метаданные

| Поле | Значение |
|------|----------|
| ID | TASK-TMP-GATE |
| Статус | \`${status}\` |

## 2. Scope

### Разрешённые файлы и каталоги

- \`src/pages/gallery/ttlPreset.ts\`

## 3. Business invariants

- N/A

## 4. Acceptance criteria

### Автоматические проверки

- typecheck

## 5. Rollback

- git restore
`;
}

function runCheck(file, args) {
  return spawnSync(process.execPath, [script, file, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function readHash(file) {
  const m = readFileSync(file, "utf8").match(/^approval_hash:\s*(\S+)/m);
  assert.ok(m, "ожидался approval_hash");
  return m[1];
}

function sealAndReadHash(file) {
  const r = runCheck(file, ["--seal"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return readHash(file);
}

function setupRepoWithApprovedHead() {
  const dir = mkdtempSync(join(tmpdir(), "task-check-git-"));
  const file = join(dir, TASK_NAME);
  initRepo(dir);
  writeFileSync(join(dir, "README.md"), "base\n", "utf8");
  commitAll(dir, "code base");
  const codeBase = gitRun(dir, ["rev-parse", "HEAD"]);
  writeFileSync(file, taskMarkdown({ status: "draft", base: codeBase }), "utf8");
  commitAll(dir, "task draft at base lineage");
  writeFileSync(file, taskMarkdown({ status: "approved", base: codeBase }), "utf8");
  const hash = sealAndReadHash(file);
  commitAll(dir, "approve task");
  return { dir, file, codeBase, hash };
}

test("lint EXAMPLE без --strict — OK", () => {
  const r = runCheck("docs/refactoring/tasks/TASK-EXAMPLE-000.md", []);
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test("цепочка seal / in_progress / смена scope", () => {
  const { dir, file, codeBase, hash } = setupRepoWithApprovedHead();
  try {
    let r = runCheck(file, ["--auth"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    writeFileSync(
      file,
      taskMarkdown({
        status: "approved",
        base: codeBase,
        hash,
        extraPath: "src/pages/gallery/GalleryPage.tsx",
      }),
      "utf8",
    );
    r = runCheck(file, ["--auth"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /approval_hash не совпадает/);

    writeFileSync(
      file,
      taskMarkdown({ status: "in_progress", base: codeBase, hash }),
      "utf8",
    );
    r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    r = runCheck(file, ["--auth"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    r = runCheck(file, ["--seal"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /in_progress не печатает/);

    writeFileSync(
      file,
      taskMarkdown({ status: "in_progress", base: codeBase }),
      "utf8",
    );
    r = runCheck(file, ["--auth"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /нет approval_hash/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("base_commit draft в истории, HEAD approved+seal → preflight PASS", () => {
  const { dir, file } = setupRepoWithApprovedHead();
  try {
    const r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HEAD draft, рабочая approved → FAIL", () => {
  const dir = mkdtempSync(join(tmpdir(), "task-check-git-"));
  const file = join(dir, TASK_NAME);
  try {
    initRepo(dir);
    writeFileSync(join(dir, "README.md"), "base\n", "utf8");
    commitAll(dir, "code base");
    const codeBase = gitRun(dir, ["rev-parse", "HEAD"]);
    writeFileSync(file, taskMarkdown({ status: "draft", base: codeBase }), "utf8");
    commitAll(dir, "task draft HEAD");
    writeFileSync(file, taskMarkdown({ status: "approved", base: codeBase }), "utf8");
    sealAndReadHash(file);
    const r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /HEAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("несовпадение base_commit с HEAD → FAIL", () => {
  const { dir, file, codeBase, hash } = setupRepoWithApprovedHead();
  try {
    writeFileSync(
      file,
      taskMarkdown({ status: "approved", base: "0".repeat(40), hash }),
      "utf8",
    );
    const r = runCheck(file, ["--auth"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /base_commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("несовпадение approval_hash с HEAD → FAIL", () => {
  const { dir, file, codeBase, hash } = setupRepoWithApprovedHead();
  try {
    writeFileSync(
      file,
      taskMarkdown({ status: "approved", base: codeBase, hash: "f".repeat(64) }),
      "utf8",
    );
    const r = runCheck(file, ["--auth"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /approval_hash/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("изменение scope после утверждения → FAIL", () => {
  const { dir, file, codeBase, hash } = setupRepoWithApprovedHead();
  try {
    writeFileSync(
      file,
      taskMarkdown({
        status: "approved",
        base: codeBase,
        hash,
        extraPath: "src/pages/gallery/GalleryPage.tsx",
      }),
      "utf8",
    );
    const r = runCheck(file, ["--auth"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /approval_hash не совпадает|контракт/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("рабочий in_progress при утверждённом HEAD → PASS", () => {
  const { dir, file, codeBase, hash } = setupRepoWithApprovedHead();
  try {
    writeFileSync(
      file,
      taskMarkdown({ status: "in_progress", base: codeBase, hash }),
      "utf8",
    );
    const r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TASK отсутствует в HEAD → FAIL", () => {
  const dir = mkdtempSync(join(tmpdir(), "task-check-git-"));
  const file = join(dir, TASK_NAME);
  try {
    initRepo(dir);
    writeFileSync(join(dir, "README.md"), "base\n", "utf8");
    commitAll(dir, "code base");
    const codeBase = gitRun(dir, ["rev-parse", "HEAD"]);
    writeFileSync(file, taskMarkdown({ status: "approved", base: codeBase }), "utf8");
    const hash = sealAndReadHash(file);
    assert.ok(hash);
    const r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /отсутствует в HEAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
