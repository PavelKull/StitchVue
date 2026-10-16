import test from "node:test";
import assert from "node:assert/strict";
import type { ImageFile } from "../../entities/image/types.ts";
import { initI18n } from "../../shared/i18n/i18n.ts";
import {
  batchUnfavoriteConfirmLines,
  batchUnfavoritePromptCopy,
  unfavoriteConfirmKindLabel,
  cleanupOutcomeFromStatus,
  historyWithoutRemovedFolder,
  interpretRemovalOutcome,
  mergeCleanupOutcomes,
  parentDirectory,
  pickCleanupFromResults,
  pickRemovedServiceFolder,
  massUnfavoriteFinishLandingKey,
  massUnfavoriteStartLandingKey,
  shouldApplyMassUnfavoriteSelectionReset,
  prepareFavoriteRemovalTargets,
  summarizeUnfavoriteBatch,
  successfulRemovalKeys,
  unfavoriteProgressLabel,
} from "./removeFavoritesBatch.ts";
import type { RemoveFavoriteCopyResult } from "./fileOperation.ts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
  };
}

(globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
initI18n();

const noCleanup = cleanupOutcomeFromStatus(null, null);

function file(path: string): ImageFile {
  return { path, size: 1, modifiedAt: 0, name: path.split("\\").pop() ?? path };
}

test("batch confirm lines map confirmKind to user-facing labels", () => {
  const previews = [
    {
      path: "C:\\Album\\Избранное\\a.jpg",
      result: { status: "needs_confirm" as const, confirmKind: "ambiguous_origin" as const, undoId: "" },
      classifyDebug: {
        basename: "a.jpg",
        snapshotPresent: true,
        recordVersion: 2,
        reasonCode: "ambiguous_origin",
        copyCheck: "unchanged",
        originCheck: "missing_parent_byte_match",
      },
    },
  ];
  const lines = batchUnfavoriteConfirmLines([file("C:\\Album\\Избранное\\a.jpg")], previews);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].basename, "a.jpg");
  assert.equal(lines[0].label, unfavoriteConfirmKindLabel("ambiguous_origin"));
});

test("mass unfavorite finish keeps current folder when user navigated away during background work", () => {
  const favorites = "C:\\Photos\\Избранное";
  const parent = "C:\\Photos";
  const other = "D:\\Elsewhere";
  const start = massUnfavoriteStartLandingKey({
    currentPath: favorites,
    sessionPath: favorites,
    parentDirectory: parent,
  });
  assert.equal(start, parent.toLowerCase());
  const finish = massUnfavoriteFinishLandingKey({
    currentPath: other,
    sessionPath: favorites,
    parentDirectory: parent,
    navigateLocation: null,
  });
  assert.equal(finish, other.toLowerCase());
});

test("mass unfavorite finish selection reset only while still in favorites session", () => {
  const favorites = "C:\\Photos\\Избранное";
  const parent = "C:\\Photos";
  assert.equal(
    shouldApplyMassUnfavoriteSelectionReset({ currentPath: favorites, sessionPath: favorites }),
    true,
  );
  assert.equal(
    shouldApplyMassUnfavoriteSelectionReset({ currentPath: parent, sessionPath: favorites }),
    false,
  );
  assert.equal(
    shouldApplyMassUnfavoriteSelectionReset({ currentPath: "D:\\Elsewhere", sessionPath: favorites }),
    false,
  );
  assert.equal(
    shouldApplyMassUnfavoriteSelectionReset({ currentPath: null, sessionPath: favorites }),
    false,
  );
});

test("prepareFavoriteRemovalTargets keeps only files in the open favorites folder and dedupes", () => {
  const favorites = "C:\\Photos\\Избранное";
  const targets = prepareFavoriteRemovalTargets(
    [
      file("C:\\Photos\\Избранное\\a.jpg"),
      file("\\\\?\\C:\\Photos\\Избранное\\a.jpg"),
      file("C:\\Photos\\Избранное\\b.jpg"),
      file("C:\\Photos\\other\\c.jpg"),
    ],
    favorites,
  );
  assert.deepEqual(
    targets.map((item) => item.path),
    ["C:\\Photos\\Избранное\\a.jpg", "C:\\Photos\\Избранное\\b.jpg"],
  );
});

test("prepareFavoriteRemovalTargets sorts deterministically", () => {
  const favorites = "D:\\Album\\Избранное";
  const targets = prepareFavoriteRemovalTargets(
    [file("D:\\Album\\Избранное\\z.jpg"), file("D:\\Album\\Избранное\\a.jpg")],
    favorites,
  );
  assert.deepEqual(
    targets.map((item) => item.path),
    ["D:\\Album\\Избранное\\a.jpg", "D:\\Album\\Избранное\\z.jpg"],
  );
});

test("parentDirectory handles Windows paths including extended prefix leaves", () => {
  assert.equal(parentDirectory("C:\\Photos\\Избранное\\a.jpg"), "C:\\Photos\\Избранное");
  assert.equal(parentDirectory("C:\\Photos\\Избранное"), "C:\\Photos");
});

test("historyWithoutRemovedFolder drops favorites entries and keeps other folders", () => {
  const history = {
    index: 4,
    entries: [null, "C:\\Photos", "C:\\Photos\\Избранное", "C:\\Photos\\Избранное", "C:\\Photos\\Trip"],
  };
  const next = historyWithoutRemovedFolder(history, "C:\\Photos\\Избранное", "C:\\Photos");
  assert.deepEqual(next.entries, [null, "C:\\Photos", "C:\\Photos\\Trip"]);
  assert.equal(next.index, 2);
});

test("historyWithoutRemovedFolder collapses duplicates after removal when current was favorites", () => {
  const history = {
    index: 2,
    entries: ["C:\\Photos", "C:\\Photos\\Избранное", "\\\\?\\C:\\Photos\\Избранное"],
  };
  const next = historyWithoutRemovedFolder(
    history,
    "\\\\?\\C:\\Photos\\Избранное",
    "C:\\Photos",
  );
  assert.deepEqual(next.entries, ["C:\\Photos"]);
  assert.equal(next.index, 0);
});

test("interpretRemovalOutcome maps needs_confirm and success", () => {
  const confirm = interpretRemovalOutcome("a.jpg", {
    status: "needs_confirm",
    undoId: "",
    confirmKind: "origin_changed",
  } as RemoveFavoriteCopyResult);
  assert.equal(confirm.status, "needs_confirm");
  if (confirm.status === "needs_confirm") {
    assert.equal(confirm.confirmKind, "origin_changed");
  }
  const recycled = interpretRemovalOutcome("a.jpg", {
    status: "recycled",
    undoId: "",
  } as RemoveFavoriteCopyResult);
  assert.equal(recycled.status, "recycled");
});

test("summarizeUnfavoriteBatch covers full success, folder deleted, partial, and cleanup failure", () => {
  assert.equal(
    summarizeUnfavoriteBatch({
      total: 12,
      succeeded: 12,
      failed: 0,
      skipped: 0,
      cleanup: noCleanup,
      errors: [],
    }).text,
    "Избранные изображения исключены: 12",
  );
  assert.equal(
    summarizeUnfavoriteBatch({
      total: 3,
      succeeded: 3,
      failed: 0,
      skipped: 0,
      cleanup: cleanupOutcomeFromStatus("removed", {
        parentDirectory: "C:\\Photos",
        folderPath: "C:\\Photos\\Избранное",
      }),
      errors: [],
    }).text,
    "Все изображения исключены. Папка „Избранное“ удалена",
  );
  const partial = summarizeUnfavoriteBatch({
    total: 12,
    succeeded: 9,
    failed: 1,
    skipped: 2,
    cleanup: noCleanup,
    errors: ["файл занят"],
  });
  assert.equal(partial.tone, "partial");
  assert.equal(partial.text, "Исключено: 9 из 12. Не удалось обработать: 3");
  assert.deepEqual(partial.details, ["файл занят"]);
  assert.equal(
    summarizeUnfavoriteBatch({
      total: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
      cleanup: cleanupOutcomeFromStatus("failed", null),
      errors: [],
    }).text,
    "Изображения исключены, но не удалось удалить пустую папку „Избранное“",
  );
});

test("already_gone navigates without claiming app deleted the folder", () => {
  const location = {
    parentDirectory: "C:\\Photos",
    folderPath: "C:\\Photos\\Избранное",
  };
  const cleanup = cleanupOutcomeFromStatus("already_gone", location);
  assert.equal(cleanup.appRemovedFolder, false);
  assert.equal(cleanup.navigateLocation?.folderPath, location.folderPath);
  assert.equal(
    summarizeUnfavoriteBatch({
      total: 2,
      succeeded: 2,
      failed: 0,
      skipped: 0,
      cleanup,
      errors: [],
    }).text,
    "Избранные изображения исключены: 2",
  );
});

test("not_empty keeps folder and does not treat it as a photo failure", () => {
  const notice = summarizeUnfavoriteBatch({
    total: 4,
    succeeded: 4,
    failed: 0,
    skipped: 0,
    cleanup: cleanupOutcomeFromStatus("not_empty", null),
    errors: [],
  });
  assert.equal(notice.tone, "ok");
  assert.match(notice.text, /сохранена/);
  assert.match(notice.text, /другие файлы/);
});

test("mergeCleanupOutcomes uses fallback when Rust omitted cleanup status", () => {
  const merged = mergeCleanupOutcomes(noCleanup, {
    status: "already_gone",
    location: {
      parentDirectory: "C:\\Photos",
      folderPath: "C:\\Photos\\Избранное",
    },
  });
  assert.equal(merged.status, "already_gone");
  assert.ok(merged.navigateLocation);
});

test("pickCleanupFromResults reads cleanupStatus from the last success", () => {
  const results = [
    interpretRemovalOutcome("C:\\F\\a.jpg", {
      status: "recycled",
      undoId: "",
      cleanupStatus: "not_empty",
    } as RemoveFavoriteCopyResult),
    interpretRemovalOutcome("C:\\F\\b.jpg", {
      status: "recycled",
      undoId: "",
      cleanupStatus: "already_gone",
      removedServiceFolder: {
        parentDirectory: "C:\\Photos",
        folderPath: "C:\\Photos\\Избранное",
      },
    } as RemoveFavoriteCopyResult),
  ];
  const cleanup = pickCleanupFromResults(results);
  assert.equal(cleanup.status, "already_gone");
  assert.equal(cleanup.navigateLocation?.folderPath, "C:\\Photos\\Избранное");
});

test("batch dialog and progress labels are stable", () => {
  assert.match(batchUnfavoritePromptCopy(4).text, /4/);
  assert.equal(unfavoriteProgressLabel(8, 12), "Обработано 8 из 12");
});

test("pickRemovedServiceFolder and successfulRemovalKeys read the last cleanup", () => {
  const results = [
    interpretRemovalOutcome("C:\\F\\a.jpg", {
      status: "recycled",
      undoId: "",
    } as RemoveFavoriteCopyResult),
    interpretRemovalOutcome("C:\\F\\b.jpg", {
      status: "relocated",
      undoId: "",
      removedServiceFolder: {
        parentDirectory: "C:\\Photos",
        folderPath: "C:\\Photos\\Избранное",
      },
    } as RemoveFavoriteCopyResult),
  ];
  assert.equal(pickRemovedServiceFolder(results)?.folderPath, "C:\\Photos\\Избранное");
  assert.deepEqual([...successfulRemovalKeys(results)].sort(), [
    "c:\\f\\a.jpg",
    "c:\\f\\b.jpg",
  ]);
});
