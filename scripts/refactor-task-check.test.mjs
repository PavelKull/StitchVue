import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "refactor-task-check.mjs");

function gitHead() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
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

test("lint EXAMPLE без --strict — OK", () => {
  const r = runCheck("docs/refactoring/tasks/TASK-EXAMPLE-000.md", []);
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test("цепочка seal / in_progress / смена scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "task-check-"));
  const file = join(dir, "TASK-TMP-GATE.md");
  const head = gitHead();

  try {
    writeFileSync(file, taskMarkdown({ status: "draft", base: head }), "utf8");
    let r = runCheck(file, ["--seal"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /только status=approved/);

    writeFileSync(file, taskMarkdown({ status: "approved", base: head }), "utf8");
    r = runCheck(file, ["--auth"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /нет approval_hash/);

    r = runCheck(file, ["--seal"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const hash = readHash(file);

    r = runCheck(file, ["--auth"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    writeFileSync(
      file,
      taskMarkdown({
        status: "approved",
        base: head,
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
      taskMarkdown({ status: "in_progress", base: head, hash }),
      "utf8",
    );
    r = runCheck(file, ["--preflight", "--allow-unrelated-dirty"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /старт только из approved/);

    r = runCheck(file, ["--auth"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    r = runCheck(file, ["--seal"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /in_progress не печатает/);

    writeFileSync(
      file,
      taskMarkdown({ status: "in_progress", base: head }),
      "utf8",
    );
    r = runCheck(file, ["--auth"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /in_progress без печати не разрешение/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
