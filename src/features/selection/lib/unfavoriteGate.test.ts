import test from "node:test";
import assert from "node:assert/strict";
import {
  beginUnfavorite,
  beginUnfavoriteConfirmPass,
  canResolveUnfavoriteConfirm,
  canStartUnfavorite,
  endUnfavorite,
  idleUnfavoriteGate,
  markUnfavoriteConfirmPending,
  matchesUnfavoriteFlight,
} from "./unfavoriteGate.ts";

test("cannot start a second unfavorite while busy or confirm is pending", () => {
  const idle = idleUnfavoriteGate();
  assert.equal(canStartUnfavorite(idle), true);
  const busy = beginUnfavorite("s1");
  assert.equal(canStartUnfavorite(busy), false);
  assert.equal(matchesUnfavoriteFlight(busy, "s1"), true);
  assert.equal(matchesUnfavoriteFlight(busy, "other"), false);
  const pending = markUnfavoriteConfirmPending(busy);
  assert.equal(canStartUnfavorite(pending), false);
  assert.equal(canResolveUnfavoriteConfirm(pending, "s1"), true);
  assert.equal(canResolveUnfavoriteConfirm(pending, "other"), false);
});

test("confirm pass accepts once then rejects a second resolve", () => {
  const pending = markUnfavoriteConfirmPending(beginUnfavorite("batch-1"));
  const pass = beginUnfavoriteConfirmPass(pending, "batch-1");
  assert.ok(pass);
  assert.equal(pass.confirmPending, false);
  assert.equal(pass.busy, true);
  assert.equal(pass.flightToken, "batch-1");
  assert.equal(beginUnfavoriteConfirmPass(pass, "batch-1"), null);
  assert.equal(canStartUnfavorite(pass), false);
});

test("cancel and end release the lock for a retry", () => {
  const pending = markUnfavoriteConfirmPending(beginUnfavorite("s2"));
  assert.equal(canStartUnfavorite(pending), false);
  const idle = endUnfavorite();
  assert.equal(canStartUnfavorite(idle), true);
  assert.equal(idle.sessionId, null);
  assert.equal(idle.flightToken, null);
  assert.equal(matchesUnfavoriteFlight(idle, "s2"), false);
});

test("single confirm cannot be resolved after cancel", () => {
  const pending = markUnfavoriteConfirmPending(beginUnfavorite("single"));
  const cancelled = endUnfavorite();
  assert.equal(canResolveUnfavoriteConfirm(cancelled, "single"), false);
  assert.equal(
    beginUnfavoriteConfirmPass(pending, "single")?.sessionId,
    "single",
  );
});

test("stale flight token cannot resolve after end (EC-18 assist)", () => {
  const pending = markUnfavoriteConfirmPending(beginUnfavorite("flight-a"));
  assert.equal(canResolveUnfavoriteConfirm(pending, "flight-a"), true);
  const ended = endUnfavorite();
  assert.equal(canResolveUnfavoriteConfirm(ended, "flight-a"), false);
  assert.equal(beginUnfavoriteConfirmPass(ended, "flight-a"), null);
  const next = markUnfavoriteConfirmPending(beginUnfavorite("flight-b"));
  assert.equal(canResolveUnfavoriteConfirm(next, "flight-a"), false);
  assert.equal(canResolveUnfavoriteConfirm(next, "flight-b"), true);
});
