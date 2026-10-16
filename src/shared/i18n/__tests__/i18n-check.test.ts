import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("i18n-check", () => {
  it("passes RU/EN parity and static key scan", () => {
    const result = spawnSync(process.execPath, [join(root, "scripts/i18n-check.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /i18n-check OK/);
  });
});
