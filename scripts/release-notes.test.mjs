import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReleaseNotes, previousReleaseTag } from "./release-notes.mjs";

test("groups user-facing commits and skips internal ones", () => {
  const notes = formatReleaseNotes("v0.1.5", [
    "chore(release): bump version to 0.1.5",
    "docs(release): update guide",
    "fix(gallery): smooth scroll jump with visible scrollbar (B-001)",
    "feat(favorites): coordinate queued adds",
    "perf(favorites): duplicate hint fast-path on re-add",
    "refactor(ai): optimize agent context",
    "fix(gallery): smooth scroll jump with visible scrollbar (B-001)",
  ]);

  assert.equal(
    notes,
    [
      "Что нового в 0.1.5",
      "",
      "Новое",
      "• Избранное: coordinate queued adds",
      "",
      "Исправления",
      "• Галерея: smooth scroll jump with visible scrollbar",
      "",
      "Скорость",
      "• Избранное: duplicate hint fast-path on re-add",
    ].join("\n"),
  );
});

test("uses a short line when the tag has no user-facing commits", () => {
  const notes = formatReleaseNotes("0.1.2", ["chore(release): bump version to 0.1.2", "test: pin locale"]);
  assert.equal(notes, "Что нового в 0.1.2\n\nНебольшие внутренние улучшения.");
});

test("picks the newest older semver tag", () => {
  assert.equal(
    previousReleaseTag(["v0.1.0", "v0.1.2", "v0.2.0", "v0.1.1-test", "nightly"], "v0.1.4"),
    "v0.1.2",
  );
  assert.equal(previousReleaseTag(["v0.1.4"], "v0.1.4"), null);
});
